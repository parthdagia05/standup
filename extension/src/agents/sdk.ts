import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { secret } from "../config";

let cached: Promise<typeof Sdk> | null = null;

/**
 * The SDK is ESM-only and this extension is bundled as CommonJS. A Function-
 * wrapped import() survives bundling, so Node performs a real ESM import.
 */
export function loadSdk(): Promise<typeof Sdk> {
  const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<typeof Sdk>;
  cached ??= dynamicImport("@anthropic-ai/claude-agent-sdk");
  return cached;
}

/**
 * Environment for agent processes. With ANTHROPIC_API_KEY set the agents use
 * the API; without it they fall back to this machine's Claude Code login.
 */
export function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const key = secret("ANTHROPIC_API_KEY");
  if (key) env.ANTHROPIC_API_KEY = key;
  return env;
}

export const authMode = () => (secret("ANTHROPIC_API_KEY") ? "API key" : "Claude Code login");
