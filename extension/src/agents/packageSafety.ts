const MIN_WEEKLY_DOWNLOADS = 100_000;
const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare"];

export interface Verdict {
  safe: boolean;
  /** Spoken explanation, e.g. "zod is widely used and runs no install scripts". */
  reason: string;
}

/** Package names from an npm/pnpm/yarn install command; [] for a bare `npm install`. */
export function packagesIn(command: string): string[] {
  const m = command.match(/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b(.*)/);
  if (!m) return [];
  return m[1]
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"))
    .map((t) => t.replace(/^(@?[^@\s]+)@.*$/, "$1"))
    .filter((t) => /^(@[\w.-]+\/)?[\w.-]+$/.test(t));
}

/**
 * Safe means: it exists on npm, lots of people use it, it isn't deprecated,
 * and installing it doesn't run scripts on this machine. Anything we can't
 * verify counts as unsafe, so the developer gets asked.
 */
export async function checkPackages(names: string[]): Promise<Verdict> {
  const results = await Promise.all(names.map(checkOne));
  const bad = results.find((r) => !r.safe);
  if (bad) return bad;
  return { safe: true, reason: results.map((r) => r.reason).join(", and ") };
}

async function checkOne(name: string): Promise<Verdict> {
  try {
    const encoded = name.replace("/", "%2F");
    const [manifestRes, downloadsRes] = await Promise.all([
      fetchWithTimeout(`https://registry.npmjs.org/${encoded}/latest`),
      fetchWithTimeout(`https://api.npmjs.org/downloads/point/last-week/${name}`),
    ]);
    if (manifestRes.status === 404) return { safe: false, reason: `${name} doesn't exist on npm, which could be a typo or a fake package` };
    if (!manifestRes.ok) return { safe: false, reason: `I couldn't check ${name} on npm` };
    const manifest = (await manifestRes.json()) as { deprecated?: string; scripts?: Record<string, string> };
    if (manifest.deprecated) return { safe: false, reason: `${name} is deprecated` };
    const hooks = INSTALL_HOOKS.filter((h) => manifest.scripts?.[h]);
    if (hooks.length) return { safe: false, reason: `${name} runs a ${hooks[0]} script on your laptop when installed` };
    const downloads = downloadsRes.ok ? ((await downloadsRes.json()) as { downloads?: number }).downloads ?? 0 : 0;
    if (downloads < MIN_WEEKLY_DOWNLOADS) return { safe: false, reason: `${name} isn't widely used, about ${round(downloads)} downloads a week` };
    return { safe: true, reason: `${name} is widely used, about ${round(downloads)} downloads a week, and runs no install scripts` };
  } catch {
    return { safe: false, reason: `I couldn't reach npm to check ${name}` };
  }
}

function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(5000) });
}

function round(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} million`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} thousand`;
  return String(n);
}
