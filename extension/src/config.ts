import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

let env: Record<string, string> = {};

/** Loads extension/.env. Real environment variables win over the file. */
export function loadEnv(extensionPath: string): void {
  env = {};
  const file = path.join(extensionPath, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function secret(name: string): string | undefined {
  const v = process.env[name] || env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("standup").get<T>(key) ?? fallback;
}

export const config = {
  repoPath(): string | undefined {
    const configured = setting("repoPath", "");
    if (configured) return configured;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  },
  model: () => setting("model", "claude-sonnet-5-5"),
  leadModel: () => setting("leadModel", "claude-sonnet-5-5"),
  parseModel: () => setting("parseModel", "claude-haiku-5-5"),
  voice: () => setting<"auto" | "cartesia" | "say" | "off">("voice", "auto"),
  phoneNumber: () => setting("phoneNumber", "") || secret("STANDUP_PHONE") || "",
  serverPort: () => setting("serverPort", 7777),
};

/**
 * PATH for child processes. VS Code launched from the Dock doesn't inherit the
 * shell PATH, so Homebrew tools like sox would otherwise go missing.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin"];
  const current = (process.env.PATH || "").split(":");
  return { ...process.env, PATH: [...extra.filter((p) => !current.includes(p)), ...current].join(":") };
}
