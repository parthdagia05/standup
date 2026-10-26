import { z } from "zod";
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { AgentName, bus } from "../bus";
import { decisions } from "../decisions/router";
import { speech } from "../voice/tts";

export type FolderAgent = Exclude<AgentName, "lead">;

/** What the tools need from the orchestrator. */
export interface TeamContext {
  assignTask(agent: FolderAgent, task: string): void;
  publishContract(from: AgentName, contract: string): void;
  /** Resolves with the contract, or early with teammate messages that arrive first. */
  waitForContract(agent: AgentName, timeoutMs: number): Promise<{ contract?: string; messages?: string[] }>;
  askTeammate(from: AgentName, to: FolderAgent, request: string): Promise<string>;
  /** Out-loud message to a teammate; answers a pending `discuss` from them. */
  sayTo(from: AgentName, to: AgentName, text: string): void;
  /** Out-loud message that waits for the teammate's reply. */
  discuss(from: AgentName, to: AgentName, text: string, timeoutMs: number): Promise<string | null>;
  /** Teammate messages and developer notes this agent hasn't seen yet. */
  takeInbox(agent: AgentName): string[];
}

export const SERVER_NAME = "standup";
export const toolId = (name: string) => `mcp__${SERVER_NAME}__${name}`;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const TEAMMATES = ["lead", "frontend", "backend", "tests"] as const;

/** Spoken lines stay short; agents ramble when allowed to. */
function trimSpoken(said: string): string {
  const words = said.trim().split(/\s+/);
  return words.length > 32 ? words.slice(0, 32).join(" ") + "…" : said.trim();
}

export function buildTools(sdk: typeof Sdk, agent: AgentName, team: TeamContext) {
  const { tool, createSdkMcpServer } = sdk;

  // Piggyback unseen messages on every tool result so agents hear teammates mid-task.
  const reply = (t: string) => {
    const inbox = team.takeInbox(agent);
    return text(inbox.length ? `${t}\n\nMESSAGES FOR YOU (reply with say_to if one needs an answer):\n${inbox.map((m) => `- ${m}`).join("\n")}` : t);
  };

  const speak = tool(
    "speak",
    "Say one short, natural sentence out loud to the developer (under 20 words).",
    { text: z.string().describe("One short spoken sentence, conversational, no markdown") },
    async ({ text: said }) => {
      const line = trimSpoken(said);
      bus.emit({ type: "speak", agent, text: line });
      speech.say(agent, line);
      return reply("ok");
    },
  );

  const sayTo = tool(
    "say_to",
    "Talk to a teammate out loud (the developer hears it too). Use their name, e.g. 'Hey Frontend, …'. Doesn't wait for a reply.",
    {
      agent: z.enum(TEAMMATES),
      text: z.string().describe("One or two short spoken sentences addressed to the teammate"),
    },
    async ({ agent: to, text: said }) => {
      if (to === agent) return reply("That's you.");
      team.sayTo(agent, to, trimSpoken(said));
      return reply("Said.");
    },
  );

  const tools: Sdk.SdkMcpToolDefinition<any>[] = [speak, sayTo];

  if (agent === "lead") {
    tools.push(
      tool(
        "ask_user",
        "Ask the developer ONE clarifying product question before planning. Blocks until they answer.",
        {
          question: z.string().describe("Under 20 words, conversational"),
          options: z.array(z.string()).min(2).max(3).describe("2-3 short answers, e.g. ['Yes, server-side', 'No, client-side']"),
        },
        async ({ question, options }) => {
          const choice = await decisions.request("lead", question, options, "other");
          return reply(`The developer answered: "${choice}".`);
        },
      ),
      tool(
        "assign_task",
        "Assign a task to a folder agent. Call once per folder that needs work.",
        {
          agent: z.enum(["frontend", "backend", "tests"]),
          task: z.string().describe("2-3 sentences in product terms, including the developer's answers"),
        },
        async ({ agent: to, task }) => {
          team.assignTask(to, task);
          return reply(`Assigned to ${to}.`);
        },
      ),
    );
    return finish();
  }

  tools.push(
    tool(
      "request_decision",
      "Ask the developer to make a decision. Blocks until they answer (by voice, click or phone). Returns the chosen option.",
      {
        question: z.string().describe("Under 20 words, conversational, says why it matters"),
        options: z.array(z.string()).min(2).max(4).describe("2-3 short concrete options, each under 8 words"),
        reason: z.enum(["package", "schema", "contract", "test", "destructive", "access", "other"]).default("other"),
      },
      async ({ question, options, reason }) => {
        const choice = await decisions.request(agent, question, options, reason);
        return reply(`The developer chose: "${choice}". That's final; go with it.`);
      },
    ),
    tool(
      "discuss",
      "Ask a teammate something out loud and wait for their answer (up to about a minute). Use their name. Good for agreeing on an API before building.",
      {
        agent: z.enum(["frontend", "backend"]),
        text: z.string().describe("Your question or proposal, one or two spoken sentences"),
      },
      async ({ agent: to, text: said }) => {
        if (to === agent) return reply("That's you.");
        const answer = await team.discuss(agent, to, trimSpoken(said), 75_000);
        return reply(answer ? `${cap(to)} replied: "${answer}"` : `${cap(to)} didn't reply in time. Use your best judgement.`);
      },
    ),
  );

  // Only the tests agent may ask for code changes: it runs last, after every
  // API decision is settled.
  if (agent === "tests") {
    tools.push(
      tool(
        "ask_teammate",
        "Ask the backend agent to make a change in backend/. Waits until it's done and returns its reply.",
        {
          agent: z.enum(["backend"]),
          request: z.string().describe("What you need changed and why, 1-3 sentences"),
        },
        async ({ agent: to, request }) => reply(await team.askTeammate(agent, to, request)),
      ),
    );
  }

  if (agent === "backend") {
    tools.push(
      tool(
        "publish_contract",
        "Publish the agreed API contract (endpoint, query params, response JSON shape) so the frontend and tests can code against it.",
        { contract: z.string().describe("Concise API description with an example response") },
        async ({ contract }) => {
          team.publishContract(agent, contract);
          return reply("Published to .standup/contracts.md and sent to the frontend.");
        },
      ),
    );
  } else {
    tools.push(
      tool(
        "wait_for_contract",
        "Wait for the API contract from the backend. Returns early if a teammate talks to you first; answer them with say_to, then call this again.",
        {},
        async () => {
          const r = await team.waitForContract(agent, 4 * 60 * 1000);
          if (r.contract) return reply(`API contract from the backend:\n${r.contract}`);
          if (r.messages?.length) {
            return text(`A teammate is talking to you. Answer with say_to, then call wait_for_contract again:\n${r.messages.map((m) => `- ${m}`).join("\n")}`);
          }
          return reply("The backend hasn't published a contract yet. Read backend/server.js and use your best judgement.");
        },
      ),
    );
  }

  return finish();

  function finish() {
    return {
      server: createSdkMcpServer({ name: SERVER_NAME, version: "1.0.0", tools }),
      names: tools.map((t) => toolId(t.name)),
    };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
