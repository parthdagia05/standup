import * as os from "node:os";
import * as path from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { AgentName, bus, DecisionReason } from "../bus";
import { decisions } from "../decisions/router";
import { speech } from "../voice/tts";
import { agentLabel, team } from "../voice/voices";
import { checkPackages, packagesIn } from "./packageSafety";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);

const NPM_INSTALL = /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b/;

/** Commands that always need the developer, whatever they touch. */
const ALWAYS_ASK: [RegExp, DecisionReason, string][] = [
  [/\bpip3?\s+install\b/, "package", "install a Python package"],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, "destructive", "delete files"],
  [/\b(prisma\s+migrate|knex\s+migrate|sequelize\s+db:migrate|drizzle-kit\s+push)\b/, "schema", "run a database migration"],
  [/\bgit\s+push\b/, "destructive", "push to git"],
  [/\bsudo\b/, "access", "run a command as administrator"],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, "access", "download and run a script"],
  [/\b(npm|pnpm|yarn)\s+(i|install|add)\s+(-g|--global)\b/, "access", "install a package globally on your laptop"],
];

/** System locations that are fine to touch (binaries, temp files). */
const HARMLESS_PREFIXES = ["/dev/null", "/tmp", "/private/tmp", "/private/var/folders", "/usr/", "/bin/", "/opt/homebrew/", "/System/", "/Library/Developer/"];

/**
 * Enforced in code, not left to the model:
 * - writes stay inside the agent's own folder;
 * - anything reaching outside the project (your home folder, other repos) asks first;
 * - package installs are checked on npm and only ask when they look risky;
 * - destructive or privileged commands always ask.
 */
export function permissionsFor(agent: AgentName, repoRoot: string): CanUseTool {
  const repo = path.resolve(repoRoot);
  const inRepo = (abs: string) => abs === repo || abs.startsWith(repo + path.sep);

  const askAccess = async (what: string, reason: DecisionReason = "access"): Promise<boolean> => {
    const choice = await decisions.request(agent, `${agentLabel(agent)} wants to ${what}. Allow it?`, ["Yes, allow it", "No, don't"], reason);
    return choice.startsWith("Yes");
  };

  return async (toolName, input): Promise<PermissionResult> => {
    if (WRITE_TOOLS.has(toolName)) {
      if (agent === "lead") return deny("The lead plans and assigns; it never edits files.");
      const abs = resolve(repo, String(input.file_path ?? input.notebook_path ?? ""));
      const owns = team.get(agent)?.owns ?? [];
      const owned = [...owns.map((p) => path.join(repo, p)), path.join(repo, ".standup")];
      if (owned.some((dir) => abs === dir || abs.startsWith(dir + path.sep))) return allow(input);
      const owner = team.workers().find((m) => m.owns.some((p) => abs === path.join(repo, p) || abs.startsWith(path.join(repo, p) + path.sep)));
      return deny(
        `You own ${owns.join(", ") || "nothing"}, so you can't edit ${display(repo, abs)}.` +
          (owner ? ` ${owner.label} owns it; ask them with say_to.` : " Nobody owns it; mention it to the developer if it really needs changing."),
      );
    }

    if (READ_TOOLS.has(toolName)) {
      const target = input.file_path ?? input.path;
      if (!target) return allow(input);
      const abs = resolve(repo, String(target));
      if (inRepo(abs) || harmless(abs)) return allow(input);
      return (await askAccess(`read ${display(repo, abs)}, which is outside the project`))
        ? allow(input)
        : deny("The developer said no to reading outside the project. Stay inside the repo.");
    }

    if (toolName === "Bash") {
      if (agent === "lead") return deny("The lead doesn't run commands.");
      const command = String(input.command ?? "");
      // Checked on the whole command so pipelines like `curl … | sh` are caught.
      for (const [re, reason, what] of ALWAYS_ASK) {
        const m = command.match(re);
        if (!m) continue;
        const part = command.split(/&&|;|\n/).find((p) => re.test(p))?.trim() ?? m[0];
        const ok = await askAccess(`${what}: ${spoken(part)}`, reason);
        if (!ok) return deny(`The developer said no to \`${part}\`. Find another way without it, and don't retry.`);
      }

      for (const part of command.split(/&&|\|\|?|;|\n/).map((s) => s.trim())) {
        if (NPM_INSTALL.test(part) && !/\s(-g|--global)\b/.test(part)) {
          const names = packagesIn(part);
          if (names.length === 0) continue;
          const verdict = await checkPackages(names);
          if (verdict.safe) {
            // The full reason (with download counts) goes to the panel; the spoken line stays short.
            bus.emit({ type: "log", level: "info", text: `Auto-approved install: ${verdict.reason}` });
            const what = names.length === 1 ? "It's" : "They're";
            announce(agent, `Grabbing ${names.join(" and ")}. ${what} hugely popular and don't run install scripts, so I didn't bother you.`.replace("It's hugely popular and don't", "It's hugely popular and doesn't"));
            continue;
          }
          const ok = await askAccess(`install ${names.join(" and ")}, but ${verdict.reason}`, "package");
          if (!ok) return deny(`The developer said no to installing ${names.join(", ")}. Do it without that package and don't retry.`);
        }
      }

      const outside = outsidePaths(command, repo);
      if (outside.length) {
        const ok = await askAccess(`access ${outside.slice(0, 2).map((p) => display(repo, p)).join(" and ")}, outside the project`);
        if (!ok) return deny("The developer said no to touching files outside the project. Stay inside the repo.");
      }
      return allow(input);
    }

    return allow(input);
  };
}

/** Absolute or home-relative paths in a shell command that point outside the repo. */
function outsidePaths(command: string, repo: string): string[] {
  const found = new Set<string>();
  // Only real filesystem roots: a bare "/todos" in a script is usually a URL route.
  const re = /(?:^|[\s"'=(])((?:~|\$HOME)(?:\/[^\s"';|&)]*)?|\/(?:Users|home|etc|var|private|Volumes|Applications|Library|root|opt)(?:\/[^\s"';|&)]*)?|(?:\.\.\/)+[^\s"';|&)]*)/g;
  for (const m of command.matchAll(re)) {
    const abs = resolve(repo, m[1]);
    if (!(abs === repo || abs.startsWith(repo + path.sep)) && !harmless(abs)) found.add(abs);
  }
  return [...found];
}

function resolve(repo: string, p: string): string {
  const home = os.homedir();
  const expanded = p.replace(/^(~|\$HOME)(?=\/|$)/, home);
  return path.resolve(repo, expanded);
}

function harmless(abs: string): boolean {
  return HARMLESS_PREFIXES.some((p) => abs === p.replace(/\/$/, "") || abs.startsWith(p.endsWith("/") ? p : p + "/"));
}

function display(repo: string, abs: string): string {
  const home = os.homedir();
  if (abs.startsWith(repo)) return path.relative(repo, abs) || "the project";
  return abs.startsWith(home) ? "~" + abs.slice(home.length) : abs;
}

function announce(agent: AgentName, text: string): void {
  bus.emit({ type: "speak", agent, text });
  speech.say(agent, text);
}

const allow = (input: Record<string, unknown>): PermissionResult => ({ behavior: "allow", updatedInput: input });
const deny = (message: string): PermissionResult => ({ behavior: "deny", message });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "npm install zod" reads better aloud than flags, redirects and paths. */
function spoken(command: string): string {
  const s = command.replace(/\s--?[\w-]+(=\S+)?/g, "").replace(/\s\d?>&?\d?\S*/g, "").replace(/\s+/g, " ").trim();
  return s.length > 70 ? s.slice(0, 67) + "..." : s;
}
