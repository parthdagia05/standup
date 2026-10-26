import * as fs from "node:fs";
import * as path from "node:path";
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { AgentName, bus } from "../bus";
import { config } from "../config";
import { decisions } from "../decisions/router";
import { speech } from "../voice/tts";
import { agentLabel } from "../voice/voices";
import { permissionsFor } from "./permissions";
import { folderPrompt, leadPrompt, summaryPrompt } from "./prompts";
import { agentEnv, authMode, loadSdk } from "./sdk";
import { buildTools, FolderAgent, TeamContext } from "./tools";

const READ_TOOLS = ["Read", "Grep", "Glob"];
const FOLDER_TOOLS = [...READ_TOOLS, "Write", "Edit", "Bash"];
const MAX_TEAMMATE_REQUESTS = 3;

/**
 * Runs one feature end to end: the lead plans, backend and frontend build in
 * parallel, tests go last, then the lead reads out a summary.
 */
export class Orchestrator implements TeamContext {
  private sdk!: typeof Sdk;
  private repo = "";
  private feature = "";
  private abort = new AbortController();
  private running = new Map<FolderAgent, Promise<string>>();
  private pendingTests: string | null = null;
  private results: string[] = [];
  private contract: string | null = null;
  private contractWaiters: ((c: string) => void)[] = [];
  private inbox = new Map<AgentName, string[]>();
  /** Agents blocked in wait_for_contract, woken when someone talks to them. */
  private inboxWaiters = new Map<AgentName, () => void>();
  /** `discuss` calls waiting on a reply, keyed by "asker>answerer". */
  private replyWaiters = new Map<string, (text: string) => void>();
  private teammateRequests = 0;
  active = false;

  async run(feature: string): Promise<void> {
    if (this.active) throw new Error("A run is already in progress");
    const repo = config.repoPath();
    if (!repo) throw new Error("Open the demo repo as your workspace folder, or set standup.repoPath");
    this.reset(repo, feature);
    this.active = true;
    bus.emit({ type: "run.started", feature });
    bus.emit({ type: "log", level: "info", text: `Run started in ${repo} (auth: ${authMode()}, model: ${config.model()})` });
    let ok = true;
    let summary: string | undefined;
    try {
      this.sdk = await loadSdk();
      await this.runAgent("lead", `The developer wants: "${feature}". Plan it as described in your instructions.`);
      await Promise.all(this.running.values());
      if (this.pendingTests !== null && !this.abort.signal.aborted) {
        const task = this.pendingTests;
        this.pendingTests = null;
        await this.startFolder("tests", task);
      }
      if (!this.abort.signal.aborted) summary = await this.summarize();
    } catch (err) {
      ok = false;
      const msg = (err as Error).message;
      if (!this.abort.signal.aborted) {
        bus.emit({ type: "log", level: "error", text: `Run failed: ${msg}` });
        speech.say("lead", "Something went wrong. Check the Standup output for details.", true);
      }
    } finally {
      this.active = false;
      bus.emit({ type: "run.finished", ok: ok && !this.abort.signal.aborted, summary });
    }
  }

  stop(): void {
    this.abort.abort();
    decisions.cancelAll();
    speech.stopAll();
  }

  /** Something the developer said while agents were busy. */
  addNote(text: string): void {
    for (const a of ["lead", "frontend", "backend", "tests"] as AgentName[]) this.deliver(a, `The developer says: "${text}"`);
  }

  // ---- TeamContext, used by the custom tools ----

  assignTask(agent: FolderAgent, task: string): void {
    bus.emit({ type: "agent.message", from: "lead", to: agent, text: task });
    // Tests wait until the code they test is written.
    if (agent === "tests") this.pendingTests = task;
    else if (!this.running.has(agent)) void this.startFolder(agent, task);
  }

  publishContract(from: AgentName, contract: string): void {
    this.contract = contract;
    const file = path.join(this.repo, ".standup", "contracts.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `\n## ${new Date().toLocaleTimeString()} — from ${agentLabel(from)}\n\n${contract}\n`);
    bus.emit({ type: "agent.message", from, to: "frontend", text: `API contract: ${contract}` });
    bus.emit({ type: "file.changed", agent: from, path: ".standup/contracts.md" });
    this.contractWaiters.splice(0).forEach((w) => w(contract));
  }

  waitForContract(agent: AgentName, timeoutMs: number): Promise<{ contract?: string; messages?: string[] }> {
    if (this.contract) return Promise.resolve({ contract: this.contract });
    const unread = this.takeInbox(agent);
    if (unread.length) return Promise.resolve({ messages: unread });
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: { contract?: string; messages?: string[] }) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        this.inboxWaiters.delete(agent);
        resolve(r);
      };
      const t = setTimeout(() => finish({}), timeoutMs);
      this.contractWaiters.push((c) => finish({ contract: c }));
      this.inboxWaiters.set(agent, () => finish({ messages: this.takeInbox(agent) }));
    });
  }

  sayTo(from: AgentName, to: AgentName, text: string): void {
    this.speakTo(from, to, text);
    const waiting = this.replyWaiters.get(`${to}>${from}`);
    if (waiting) waiting(text);
    else this.deliver(to, `${agentLabel(from)} says: "${text}"`);
  }

  discuss(from: AgentName, to: AgentName, text: string, timeoutMs: number): Promise<string | null> {
    // If they're already waiting on us, this message is the answer to them.
    const theirs = this.replyWaiters.get(`${to}>${from}`);
    this.speakTo(from, to, text);
    if (theirs) theirs(text);
    else this.deliver(to, `${agentLabel(from)} asks: "${text}" (answer with say_to ${from})`);
    return new Promise((resolve) => {
      const key = `${from}>${to}`;
      const t = setTimeout(() => {
        this.replyWaiters.delete(key);
        resolve(null);
      }, timeoutMs);
      this.replyWaiters.set(key, (reply) => {
        clearTimeout(t);
        this.replyWaiters.delete(key);
        resolve(reply);
      });
    });
  }

  async askTeammate(from: AgentName, to: FolderAgent, request: string): Promise<string> {
    if (++this.teammateRequests > MAX_TEAMMATE_REQUESTS) return "Too many cross-team requests this run. Work with what you have.";
    bus.emit({ type: "agent.message", from, to, text: request });
    await this.running.get(to)?.catch(() => {});
    const made = this.decisionLog();
    const guard = made.length ? `\n\nThe developer already decided the following. These are final; do not change them:\n${made.join("\n")}` : "";
    const result = await this.startFolder(
      to,
      `${agentLabel(from)} asks: ${request}${guard}\n\nMake only this change, then reply in one or two sentences saying what you did.`,
    );
    bus.emit({ type: "agent.message", from: to, to: from as AgentName, text: result });
    return `${agentLabel(to)} replied: ${result}`;
  }

  takeInbox(agent: AgentName): string[] {
    const n = this.inbox.get(agent) ?? [];
    this.inbox.set(agent, []);
    return n;
  }

  private deliver(to: AgentName, message: string): void {
    this.inbox.set(to, [...(this.inbox.get(to) ?? []), message]);
    this.inboxWaiters.get(to)?.();
  }

  private speakTo(from: AgentName, to: AgentName, text: string): void {
    bus.emit({ type: "agent.message", from, to, text });
    speech.say(from, text, false, true);
  }

  // ---- internals ----

  private reset(repo: string, feature: string): void {
    this.repo = repo;
    this.feature = feature;
    this.abort = new AbortController();
    this.running.clear();
    this.pendingTests = null;
    this.results = [];
    this.contract = null;
    this.contractWaiters = [];
    this.inbox.clear();
    this.inboxWaiters.clear();
    this.replyWaiters.clear();
    this.teammateRequests = 0;
    speech.resetIntroductions();
  }

  private startFolder(agent: FolderAgent, task: string): Promise<string> {
    const p = this.runAgent(agent, task).finally(() => {
      if (this.running.get(agent) === p) this.running.delete(agent);
    });
    this.running.set(agent, p);
    return p;
  }

  private async runAgent(agent: AgentName, task: string): Promise<string> {
    const { query } = this.sdk;
    const { server, names } = buildTools(this.sdk, agent, this);
    const isLead = agent === "lead";
    bus.emit({ type: "agent.status", agent, status: "thinking" });

    const q = query({
      prompt: task,
      options: {
        cwd: this.repo,
        model: isLead ? config.leadModel() : config.model(),
        effort: isLead ? "medium" : "low",
        systemPrompt: { type: "preset", preset: "claude_code", append: isLead ? leadPrompt() : folderPrompt(agent as FolderAgent) },
        tools: isLead ? READ_TOOLS : FOLDER_TOOLS,
        // Built-in tools all go through canUseTool so reads outside the repo get caught.
        allowedTools: names,
        mcpServers: { standup: server },
        canUseTool: permissionsFor(agent, this.repo),
        permissionMode: "default",
        settingSources: [],
        maxTurns: isLead ? 15 : 40,
        abortController: this.abort,
        env: agentEnv(),
      },
    });

    let result = "";
    try {
      for await (const msg of q) {
        if (msg.type === "assistant") this.onAssistant(agent, msg);
        else if (msg.type === "result") {
          if (msg.subtype === "success") result = msg.result;
          else throw new Error(`${agentLabel(agent)} stopped: ${msg.subtype}`);
        }
      }
      bus.emit({ type: "agent.status", agent, status: "done" });
      if (!isLead) this.results.push(`${agentLabel(agent)}: ${result.slice(0, 600)}`);
      return result;
    } catch (err) {
      bus.emit({ type: "agent.status", agent, status: "error", detail: (err as Error).message });
      bus.emit({ type: "log", level: "error", text: `${agentLabel(agent)}: ${(err as Error).message}` });
      if (isLead) throw err;
      this.results.push(`${agentLabel(agent)}: failed (${(err as Error).message})`);
      return `failed: ${(err as Error).message}`;
    }
  }

  private onAssistant(agent: AgentName, msg: Sdk.SDKAssistantMessage): void {
    for (const block of msg.message.content as any[]) {
      if (block.type === "text" && block.text?.trim()) {
        bus.emit({ type: "log", level: "info", text: `[${agentLabel(agent)}] ${block.text.trim()}` });
      } else if (block.type === "tool_use") {
        const input = block.input ?? {};
        const name: string = block.name;
        if (["Write", "Edit", "MultiEdit"].includes(name) && input.file_path) {
          bus.emit({ type: "file.changed", agent, path: path.relative(this.repo, path.resolve(this.repo, input.file_path)) });
        }
        if (!name.startsWith("mcp__")) {
          const detail = name === "Bash" ? `$ ${String(input.command ?? "").slice(0, 60)}` : `${name} ${path.basename(String(input.file_path ?? input.pattern ?? ""))}`;
          bus.emit({ type: "agent.status", agent, status: "working", detail });
        }
      }
    }
  }

  /** This run's answered decisions, one line each. */
  private decisionLog(): string[] {
    const asked = new Map<string, string>();
    const lines: string[] = [];
    let inRun = false;
    for (const e of bus.history) {
      if (e.type === "run.started") {
        inRun = e.feature === this.feature;
        asked.clear();
        lines.length = 0;
      } else if (!inRun) continue;
      else if (e.type === "decision.requested") asked.set(e.id, e.question);
      else if (e.type === "decision.answered" && !e.choice.startsWith("CANCELLED")) {
        lines.push(`- "${asked.get(e.id)}" → "${e.choice}" (via ${e.via})`);
      }
    }
    return lines;
  }

  private async summarize(): Promise<string> {
    const log = [...this.decisionLog().map((d) => `Decision ${d}`), ...this.results].join("\n");
    bus.emit({ type: "agent.status", agent: "lead", status: "thinking", detail: "Summarizing" });
    let summary = "All done. Check the panel for what changed.";
    try {
      const q = this.sdk.query({
        prompt: summaryPrompt(this.feature, log),
        options: { model: config.leadModel(), tools: [], maxTurns: 1, settingSources: [], abortController: this.abort, env: agentEnv() },
      });
      for await (const msg of q) if (msg.type === "result" && msg.subtype === "success" && msg.result.trim()) summary = msg.result.trim();
      // It's read aloud: two sentences is plenty.
      summary = (summary.match(/[^.!?]+[.!?]+/g) ?? [summary]).slice(0, 2).join(" ").trim();
    } catch {
      /* keep the generic summary */
    }
    bus.emit({ type: "speak", agent: "lead", text: summary });
    speech.say("lead", summary);
    bus.emit({ type: "agent.status", agent: "lead", status: "done" });
    return summary;
  }
}
