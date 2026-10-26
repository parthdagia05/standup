import { AgentName, bus, MemberInfo, MemberKind } from "../bus";
import { secret } from "../config";

export interface Member extends MemberInfo {
  /** What this teammate is responsible for, in the Lead's words. */
  role: string;
  /** Teammates that must finish before this one starts. */
  after: string[];
  /** macOS `say` voice used when there's no Cartesia key. */
  sayVoice: string;
}

export const MAX_MEMBERS = 6;

const LEAD: Member = {
  id: "lead",
  label: "Lead",
  kind: "lead",
  role: "Plans the work, hires the team and wraps up",
  owns: [],
  after: [],
  color: "#f2b84b",
  sayVoice: "Samantha",
};

// Distinct, readable on dark backgrounds, and distinct from the Lead's amber.
const COLORS = ["#4f9dff", "#3ddc97", "#ff6b9a", "#a78bfa", "#ff9f43", "#22d3ee"];
const SAY_VOICES = ["Daniel", "Rishi", "Karen", "Moira", "Tessa", "Fred"];

/** The team for the current run. Starts as just the Lead, who hires the rest. */
class Team {
  private members = new Map<AgentName, Member>([["lead", LEAD]]);

  reset(): void {
    this.members = new Map([["lead", LEAD]]);
  }

  add(spec: { id: string; label: string; kind: MemberKind; role: string; owns: string[]; after: string[] }): Member {
    const index = this.members.size - 1;
    const member: Member = {
      ...spec,
      color: COLORS[index % COLORS.length],
      sayVoice: SAY_VOICES[index % SAY_VOICES.length],
    };
    this.members.set(spec.id, member);
    return member;
  }

  get(id: AgentName): Member | undefined {
    return this.members.get(id);
  }

  all(): Member[] {
    return [...this.members.values()];
  }

  /** Everyone but the Lead. */
  workers(): Member[] {
    return this.all().filter((m) => m.id !== "lead");
  }

  info(): MemberInfo[] {
    return this.all().map(({ id, label, kind, owns, color }) => ({ id, label, kind, owns, color }));
  }
}

export const team = new Team();

export interface AgentVoice {
  label: string;
  color: string;
  sayVoice: string;
  cartesiaId?: string;
}

/**
 * Cartesia voices come from .env: CARTESIA_VOICE_LEAD for the Lead, then
 * CARTESIA_VOICE_<KIND> (e.g. CARTESIA_VOICE_BACKEND), then a pool in
 * CARTESIA_VOICES (comma-separated ids) handed out in hiring order.
 */
export function voiceFor(id: AgentName): AgentVoice {
  const m = team.get(id) ?? { ...LEAD, id, label: id, kind: "other" as MemberKind };
  const pool = (secret("CARTESIA_VOICES") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const index = team.workers().findIndex((w) => w.id === id);
  const cartesiaId =
    (m.kind === "lead" ? secret("CARTESIA_VOICE_LEAD") : undefined) ??
    secret(`CARTESIA_VOICE_${m.kind.toUpperCase()}`) ??
    (pool.length && index >= 0 ? pool[index % pool.length] : undefined);
  return { label: m.label, color: m.color, sayVoice: m.sayVoice, cartesiaId };
}

export const agentLabel = (id: AgentName) => team.get(id)?.label ?? (id === "team" ? "the team" : id);

export function announceTeam(): void {
  bus.emit({ type: "team.formed", members: team.info() });
}
