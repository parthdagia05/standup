import { EventEmitter } from "node:events";

/** "lead", or an id the Lead chose when hiring ("api", "web", "db", "tests"…). */
export type AgentName = string;

export type MemberKind = "lead" | "frontend" | "backend" | "database" | "tests" | "mobile" | "infra" | "docs" | "fullstack" | "operator" | "other";
export const WORKER_KINDS = ["frontend", "backend", "database", "tests", "mobile", "infra", "docs", "fullstack", "operator", "other"] as const;

export interface MemberInfo {
  id: AgentName;
  label: string;
  kind: MemberKind;
  /** Repo-relative paths this teammate may edit. */
  owns: string[];
  color: string;
}

export type DecisionReason = "package" | "schema" | "contract" | "test" | "destructive" | "access" | "other";
export type AnswerVia = "voice" | "phone" | "click";
export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "done" | "error";

export type BusEvent =
  | { type: "speak"; agent: AgentName; text: string }
  | { type: "user.said"; text: string }
  | { type: "decision.requested"; id: string; agent: AgentName; question: string; options: string[]; reason: DecisionReason }
  | { type: "decision.answered"; id: string; choice: string; via: AnswerVia }
  | { type: "agent.status"; agent: AgentName; status: AgentStatus; detail?: string }
  | { type: "agent.message"; from: AgentName; to: AgentName; text: string }
  | { type: "file.changed"; agent: AgentName; path: string }
  | { type: "mode.changed"; mode: "desk" | "away" }
  | { type: "speaking"; agent: AgentName | null }
  | { type: "listening"; on: boolean }
  | { type: "phone.status"; status: string; decisionId?: string }
  | { type: "team.formed"; members: MemberInfo[] }
  | { type: "run.started"; feature: string }
  | { type: "run.finished"; ok: boolean; summary?: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string };

type Handler<T extends BusEvent["type"]> = (event: Extract<BusEvent, { type: T }>) => void;

class Bus {
  private emitter = new EventEmitter();
  // Kept so a panel opened mid-run can replay what already happened.
  readonly history: BusEvent[] = [];

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: BusEvent): void {
    this.history.push(event);
    if (this.history.length > 2000) this.history.splice(0, 500);
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  on<T extends BusEvent["type"]>(type: T, handler: Handler<T>): () => void {
    this.emitter.on(type, handler as (e: BusEvent) => void);
    return () => this.emitter.off(type, handler as (e: BusEvent) => void);
  }

  onAny(handler: (event: BusEvent) => void): () => void {
    this.emitter.on("*", handler);
    return () => this.emitter.off("*", handler);
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}

export const bus = new Bus();
