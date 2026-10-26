import { config } from "../config";
import { agentEnv, loadSdk } from "../agents/sdk";

// Ordinals win over bare numbers: in "the second one", "one" isn't the answer.
const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|option (a|1)|number (one|1))\b/, 0],
  [/\b(second|2nd|option (b|2)|number (two|2))\b/, 1],
  [/\b(third|3rd|option (c|3)|number (three|3))\b/, 2],
  [/\b(fourth|4th|option (d|4)|number (four|4))\b/, 3],
];
const NUMBERS: [RegExp, number][] = [
  [/\b(one|1)\b/, 0],
  [/\b(two|2)\b/, 1],
  [/\b(three|3)\b/, 2],
  [/\b(four|4)\b/, 3],
];
const YES = /\b(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|allow|approve|fine|haan|ha|theek hai)\b/;
const NO = /\b(no|nope|don'?t|deny|reject|stop|skip|nahi)\b/;

/**
 * Maps what you said ("the second one", "go with cursor", "yes") to one of the
 * options. Cheap rules first, then a small model. Returns null when unclear.
 */
export async function matchOption(said: string, options: string[]): Promise<string | null> {
  return matchByRules(said, options) ?? askModel(said, options);
}

/**
 * A phone transcript: the first line that clearly picks an option wins (people
 * answer, then chat). Falls back to the model reading the whole conversation.
 */
export async function matchFromConversation(userLines: string[], options: string[]): Promise<string | null> {
  for (const line of userLines) {
    const hit = matchByRules(line, options);
    if (hit) return hit;
  }
  return askModel(userLines.join(" / "), options);
}

function matchByRules(said: string, options: string[]): string | null {
  const text = said.toLowerCase().replace(/[^\w\s']/g, " ");

  // An option's distinctive words appearing in the answer is the strongest signal.
  const scored = options.map((opt) => {
    const words = opt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    const others = options.filter((o) => o !== opt).join(" ").toLowerCase();
    const unique = words.filter((w) => !others.includes(w));
    return { opt, hits: unique.filter((w) => text.includes(w)).length };
  });
  const best = scored.sort((a, b) => b.hits - a.hits);
  if (best[0]?.hits > 0 && best[0].hits > (best[1]?.hits ?? 0)) return best[0].opt;

  for (const [re, i] of ORDINALS) if (re.test(text) && options[i]) return options[i];
  for (const [re, i] of NUMBERS) if (re.test(text) && options[i]) return options[i];

  const yesOpt = options.find((o) => /^(yes|allow|approve)/i.test(o));
  const noOpt = options.find((o) => /^(no|deny|reject)/i.test(o));
  if (yesOpt && noOpt) {
    const y = YES.test(text), n = NO.test(text);
    if (y && !n) return yesOpt;
    if (n && !y) return noOpt;
  }

  return null;
}

async function askModel(said: string, options: string[]): Promise<string | null> {
  try {
    const { query } = await loadSdk();
    const prompt =
      `Options:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\n` +
      `The user said: "${said}"\n\nReply with ONLY the number of the option they chose, or NONE if unclear.`;
    const run = query({
      prompt,
      options: { model: config.parseModel(), maxTurns: 1, tools: [], settingSources: [], env: agentEnv() },
    });
    let answer = "";
    const timeout = setTimeout(() => run.close(), 20000);
    for await (const msg of run) {
      if (msg.type === "result" && msg.subtype === "success") answer = msg.result;
    }
    clearTimeout(timeout);
    const n = parseInt(answer.trim(), 10);
    return Number.isInteger(n) && options[n - 1] ? options[n - 1] : null;
  } catch {
    return null;
  }
}
