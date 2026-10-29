import { z } from "zod";
import type * as Sdk from "@anthropic-ai/claude-agent-sdk";
import { AgentName, bus, WORKER_KINDS } from "../bus";
import { decisions } from "../decisions/router";
import { speech } from "../voice/tts";
import { MAX_MEMBERS, team } from "../voice/voices";

export interface HireSpec {
  id: string;
  label: string;
  kind: (typeof WORKER_KINDS)[number];
  role: string;
  owns: string[];
  task: string;
  after: string[];
}

/** What the tools need from the orchestrator. */
export interface TeamContext {
  /** Returns an error message for the Lead to fix, or null when the team is hired. */
  formTeam(members: HireSpec[]): string | null;
  publishContract(from: AgentName, contract: string): void;
  /** Resolves with the contracts so far, or early with teammate messages that arrive first. */
  waitForContract(agent: AgentName, timeoutMs: number): Promise<{ contract?: string; messages?: string[] }>;
  askTeammate(from: AgentName, to: AgentName, request: string): Promise<string>;
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

/** Spoken lines stay short; agents ramble when allowed to. */
function trimSpoken(said: string): string {
  const words = said.trim().split(/\s+/);
  return words.length > 32 ? words.slice(0, 32).join(" ") + "…" : said.trim();
}

/** Accepts an id or a spoken name ("Web", "web"). */
function resolveTeammate(name: string): AgentName | undefined {
  const n = name.trim().toLowerCase();
  return team.all().find((m) => m.id === n || m.label.toLowerCase() === n)?.id;
}

const roster = () => team.all().map((m) => `"${m.id}" (${m.label})`).join(", ");

export function buildTools(sdk: typeof Sdk, agent: AgentName, ctx: TeamContext) {
  const { tool, createSdkMcpServer } = sdk;
  const me = team.get(agent);

  // Piggyback unseen messages on every tool result so agents hear teammates mid-task.
  const reply = (t: string) => {
    const inbox = ctx.takeInbox(agent);
    return text(inbox.length ? `${t}\n\nMESSAGES FOR YOU (reply with say_to if one needs an answer):\n${inbox.map((m) => `- ${m}`).join("\n")}` : t);
  };

  const tools: Sdk.SdkMcpToolDefinition<any>[] = [
    tool(
      "speak",
      "Say one short, natural sentence out loud to the developer (under 20 words).",
      { text: z.string().describe("One short spoken sentence, conversational, no markdown") },
      async ({ text: said }) => {
        const line = trimSpoken(said);
        bus.emit({ type: "speak", agent, text: line });
        speech.say(agent, line);
        return reply("ok");
      },
    ),
    tool(
      "say_to",
      "Talk to a teammate out loud (the developer hears it too). Use their name, e.g. 'Hey Web, …'. Doesn't wait for a reply.",
      {
        agent: z.string().describe("Teammate id or name"),
        text: z.string().describe("One or two short spoken sentences addressed to the teammate"),
      },
      async ({ agent: name, text: said }) => {
        const to = resolveTeammate(name);
        if (!to) return reply(`No teammate called "${name}". The team is: ${roster()}.`);
        if (to === agent) return reply("That's you.");
        ctx.sayTo(agent, to, trimSpoken(said));
        return reply("Said.");
      },
    ),
  ];

  if (agent === "lead") {
    tools.push(
      tool(
        "ask_user",
        "Ask the developer ONE clarifying product question before hiring the team. Blocks until they answer.",
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
        "form_team",
        `Hire the team for this feature and hand out tasks (call once). 1 to ${MAX_MEMBERS} teammates with non-overlapping ownership. Teammates start as soon as everyone in their \`after\` list has finished.`,
        {
          members: z
            .array(
              z.object({
                id: z.string().describe('Short lowercase id, e.g. "api", "web", "db", "tests"'),
                label: z.string().describe('One-word spoken name, e.g. "API", "Web", "DB", "Tests"'),
                kind: z.enum(WORKER_KINDS),
                role: z.string().describe("One sentence: what this teammate is responsible for"),
                owns: z.array(z.string()).default([]).describe('Repo-relative folders or files this teammate may edit, e.g. ["backend"]. Use ["."] only for a single fullstack teammate. In laptop mode leave empty: operators may work anywhere.'),
                task: z.string().describe("2-3 sentences in product terms, including the developer's answer"),
                after: z.array(z.string()).default([]).describe("Ids of teammates that must finish first (usually only for tests)"),
              }),
            )
            .min(1)
            .max(MAX_MEMBERS),
        },
        async ({ members }) => {
          const error = ctx.formTeam(members as HireSpec[]);
          return reply(error ? `Couldn't hire that team: ${error} Fix it and call form_team again.` : `Hired: ${roster()}. They're starting now.`);
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
      "Ask a teammate something out loud and wait for their answer (up to about a minute). Use their name. Good for agreeing on an interface before building.",
      {
        agent: z.string().describe("Teammate id or name"),
        text: z.string().describe("Your question or proposal, one or two spoken sentences"),
      },
      async ({ agent: name, text: said }) => {
        const to = resolveTeammate(name);
        if (!to || to === "lead") return reply(`Discuss with a teammate who builds something: ${roster()}.`);
        if (to === agent) return reply("That's you.");
        const answer = await ctx.discuss(agent, to, trimSpoken(said), 75_000);
        const label = team.get(to)?.label ?? to;
        return reply(answer ? `${label} replied: "${answer}"` : `${label} didn't reply in time. Use your best judgement.`);
      },
    ),
    tool(
      "publish_contract",
      "Publish an agreed interface (API endpoint, schema, shared type: shape plus one example) so teammates can build against it.",
      { contract: z.string().describe("Concise description with an example") },
      async ({ contract }) => {
        ctx.publishContract(agent, contract);
        return reply("Published to .standup/contracts.md and sent to the team.");
      },
    ),
    tool(
      "wait_for_contract",
      "Wait for an interface a teammate is building for you. Returns early if a teammate talks to you first; answer them with say_to, then call this again.",
      {},
      async () => {
        const r = await ctx.waitForContract(agent, 4 * 60 * 1000);
        if (r.contract) return reply(`Published contracts:\n${r.contract}`);
        if (r.messages?.length) {
          return text(`A teammate is talking to you. Answer with say_to, then call wait_for_contract again:\n${r.messages.map((m) => `- ${m}`).join("\n")}`);
        }
        return reply("Nothing has been published yet. Read the relevant code and use your best judgement.");
      },
    ),
  );

  // Teammates who start after others (usually tests) can ask those others for
  // changes once every interface decision is settled.
  if (me?.after.length) {
    tools.push(
      tool(
        "ask_teammate",
        `Ask a teammate who finished before you (${me.after.join(", ")}) to change code they own. Waits until they're done and returns their reply.`,
        {
          agent: z.string().describe("Teammate id or name"),
          request: z.string().describe("What you need changed and why, 1-3 sentences"),
        },
        async ({ agent: name, request }) => {
          const to = resolveTeammate(name);
          if (!to || !me.after.includes(to)) return reply(`You can only ask: ${me.after.join(", ")}.`);
          return reply(await ctx.askTeammate(agent, to, request));
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
