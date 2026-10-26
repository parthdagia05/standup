import { bus } from "../bus";
import { config, secret } from "../config";
import { agentLabel } from "../voice/voices";
import type { Decision } from "./router";

const BOLNA_API = "https://api.bolna.ai";
const POLL_MS = 5000;
const CALL_TIMEOUT_MS = 6 * 60 * 1000;

interface ActiveCall {
  decisionId: string;
  executionId?: string;
  startedAt: number;
}

/**
 * Away mode: one Bolna call per decision, one call at a time. The Bolna agent
 * reports the answer by calling our /decision endpoint (custom function). If
 * that never arrives we poll the execution and read extracted_data instead.
 */
class Phone {
  private queue: Decision[] = [];
  private active: ActiveCall | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Late-bound to avoid an import cycle with the router. Gets every user line from the call. */
  onAnswer: (decisionId: string, userLines: string[]) => void = () => {};

  static configured(): { ok: boolean; why?: string } {
    if (!secret("BOLNA_API_KEY")) return { ok: false, why: "BOLNA_API_KEY is not set" };
    if (!secret("BOLNA_AGENT_ID")) return { ok: false, why: "BOLNA_AGENT_ID is not set" };
    if (!config.phoneNumber()) return { ok: false, why: "no phone number (standup.phoneNumber or STANDUP_PHONE)" };
    return { ok: true };
  }

  enqueue(d: Decision): void {
    if (this.active?.decisionId === d.id || this.queue.some((q) => q.id === d.id)) return;
    this.queue.push(d);
    void this.next();
  }

  /** Called once a decision is answered by any channel. */
  forget(decisionId: string): void {
    this.queue = this.queue.filter((d) => d.id !== decisionId);
    if (this.active?.decisionId === decisionId) {
      bus.emit({ type: "phone.status", status: "answered", decisionId });
      this.finish();
    }
  }

  cancelQueued(): void {
    this.queue = [];
  }

  private finish(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active = null;
    setTimeout(() => void this.next(), 2000);
  }

  private async next(): Promise<void> {
    if (this.active || this.queue.length === 0) return;
    const d = this.queue.shift()!;
    const check = Phone.configured();
    if (!check.ok) {
      bus.emit({ type: "phone.status", status: `can't call: ${check.why}. Answer in the panel.`, decisionId: d.id });
      return;
    }
    this.active = { decisionId: d.id, startedAt: Date.now() };
    bus.emit({ type: "phone.status", status: "calling", decisionId: d.id });
    try {
      const res = await fetch(`${BOLNA_API}/call`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret("BOLNA_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: secret("BOLNA_AGENT_ID"),
          recipient_phone_number: config.phoneNumber(),
          ...(secret("BOLNA_FROM_NUMBER") ? { from_phone_number: secret("BOLNA_FROM_NUMBER") } : {}),
          user_data: {
            agent_name: agentLabel(d.agent),
            question: d.question,
            options: d.options.join(" | "),
            decision_id: d.id,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      this.active.executionId = body.execution_id ?? body.call_id ?? body.id;
      bus.emit({ type: "phone.status", status: "ringing", decisionId: d.id });
      this.timer = setInterval(() => void this.poll(), POLL_MS);
    } catch (err) {
      bus.emit({ type: "phone.status", status: `call failed: ${(err as Error).message}`, decisionId: d.id });
      this.finish();
    }
  }

  /** Backup path when the custom function never fires. */
  private async poll(): Promise<void> {
    const call = this.active;
    if (!call?.executionId) return;
    if (Date.now() - call.startedAt > CALL_TIMEOUT_MS) {
      bus.emit({ type: "phone.status", status: "no answer, still waiting in the panel", decisionId: call.decisionId });
      return this.finish();
    }
    try {
      const res = await fetch(`${BOLNA_API}/executions/${call.executionId}`, {
        headers: { Authorization: `Bearer ${secret("BOLNA_API_KEY")}` },
      });
      if (!res.ok) return;
      const ex = (await res.json()) as any;
      const status = String(ex.status ?? "").toLowerCase();
      if (["completed", "call-disconnected", "failed", "no-answer", "busy", "canceled", "error"].includes(status)) {
        const extracted = ex.extracted_data?.choice ?? ex.extracted_data?.decision;
        const lines = typeof extracted === "string" && extracted ? [extracted] : userLines(ex.transcript);
        if (lines.length) this.onAnswer(call.decisionId, lines);
        else bus.emit({ type: "phone.status", status: `call ended (${status}) without an answer`, decisionId: call.decisionId });
        if (this.active === call) this.finish();
      }
    } catch {
      /* transient; try again next tick */
    }
  }
}

/** What the caller said, in order. The answer is usually early; the end is "bye". */
function userLines(transcript: unknown): string[] {
  if (typeof transcript !== "string") return [];
  return transcript
    .split("\n")
    .filter((l) => /^\s*user\s*:/i.test(l))
    .map((l) => l.replace(/^\s*user\s*:/i, "").trim())
    .filter(Boolean);
}

export const phone = new Phone();
export const phoneConfigured = () => Phone.configured();
