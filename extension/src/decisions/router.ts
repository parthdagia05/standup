import { AgentName, AnswerVia, bus, DecisionReason } from "../bus";
import { speech } from "../voice/tts";
import { agentLabel } from "../voice/voices";
import { matchOption } from "./parse";
import { phone } from "./phone";

export interface Decision {
  id: string;
  agent: AgentName;
  question: string;
  options: string[];
  reason: DecisionReason;
  resolve: (choice: string) => void;
}

let counter = 0;

/**
 * Every question for the human goes through here. At the desk it's spoken and
 * shown in the panel; when you're away it becomes a phone call.
 */
class DecisionRouter {
  mode: "desk" | "away" = "desk";
  private pending = new Map<string, Decision>();

  request(agent: AgentName, question: string, options: string[], reason: DecisionReason = "other"): Promise<string> {
    const id = `d_${++counter}`;
    return new Promise<string>((resolve) => {
      const decision: Decision = { id, agent, question, options, reason, resolve };
      this.pending.set(id, decision);
      bus.emit({ type: "decision.requested", id, agent, question, options, reason });
      bus.emit({ type: "agent.status", agent, status: "waiting", detail: question });
      if (this.mode === "away") phone.enqueue(decision);
      else speech.say(agent, `${question} ${spokenOptions(options)}`, true);
    });
  }

  answer(id: string, choice: string, via: AnswerVia): boolean {
    const d = this.pending.get(id);
    if (!d) return false;
    this.pending.delete(id);
    phone.forget(id);
    bus.emit({ type: "decision.answered", id, choice, via });
    bus.emit({ type: "agent.status", agent: d.agent, status: "working" });
    d.resolve(choice);
    return true;
  }

  /** Free text (voice or phone) → option. Re-asks when it can't tell. */
  async answerFromSpeech(id: string, said: string, via: AnswerVia): Promise<boolean> {
    const d = this.pending.get(id);
    if (!d) return false;
    const choice = await matchOption(said, d.options);
    if (choice) return this.answer(id, choice, via);
    if (via === "voice") speech.say(d.agent, `Sorry, I didn't catch that. ${spokenOptions(d.options)}`, true);
    return false;
  }

  /** The decision a spoken answer most likely refers to: the oldest one waiting. */
  oldestPending(): Decision | undefined {
    return this.pending.values().next().value;
  }

  get(id: string): Decision | undefined {
    return this.pending.get(id);
  }

  allPending(): Decision[] {
    return [...this.pending.values()];
  }

  setMode(mode: "desk" | "away"): void {
    if (mode === this.mode) return;
    this.mode = mode;
    bus.emit({ type: "mode.changed", mode });
    if (mode === "away") for (const d of this.pending.values()) phone.enqueue(d);
    else {
      phone.cancelQueued();
      const first = this.oldestPending();
      if (first) speech.say(first.agent, `Welcome back. ${first.question} ${spokenOptions(first.options)}`, true);
    }
  }

  /** Unblocks every waiting agent with a denial (used by Stop). */
  cancelAll(): void {
    for (const d of this.pending.values()) d.resolve("CANCELLED: the run was stopped");
    this.pending.clear();
    phone.cancelQueued();
  }
}

export function spokenOptions(options: string[]): string {
  if (options.length === 2 && /^yes/i.test(options[0]) && /^no/i.test(options[1])) return "";
  return "Options: " + options.map((o, i) => `${i + 1}, ${o}`).join(". ") + ".";
}

export const describeAsker = (agent: AgentName) => agentLabel(agent);

export const decisions = new DecisionRouter();
