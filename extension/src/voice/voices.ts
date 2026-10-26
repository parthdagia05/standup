import { AgentName } from "../bus";
import { secret } from "../config";

export interface AgentVoice {
  label: string;
  color: string;
  /** Cartesia voice id, from CARTESIA_VOICE_<AGENT> in .env. */
  cartesiaId?: string;
  /** macOS `say` voice used when there's no Cartesia key. */
  sayVoice: string;
}

const base: Record<AgentName, Omit<AgentVoice, "cartesiaId">> = {
  lead: { label: "Lead", color: "#c08a2e", sayVoice: "Samantha" },
  frontend: { label: "Frontend", color: "#3f7fd6", sayVoice: "Daniel" },
  backend: { label: "Backend", color: "#2e9a6a", sayVoice: "Rishi" },
  tests: { label: "Tests", color: "#b0477a", sayVoice: "Karen" },
};

export function voiceFor(agent: AgentName): AgentVoice {
  return { ...base[agent], cartesiaId: secret(`CARTESIA_VOICE_${agent.toUpperCase()}`) };
}

export const agentLabel = (agent: AgentName) => base[agent].label;
