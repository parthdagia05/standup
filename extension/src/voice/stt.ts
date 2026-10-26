import { ChildProcess, spawn } from "node:child_process";
import { childEnv, secret } from "../config";

const SAMPLE_RATE = 16000;

/**
 * Push-to-talk recorder: `start()` spawns sox's `rec`, `stop()` ends it and
 * sends the clip to Deepgram's pre-recorded endpoint. One request per
 * utterance is simpler and more reliable than a live websocket.
 */
export class Recorder {
  private proc: ChildProcess | null = null;
  private chunks: Buffer[] = [];
  private error: string | null = null;

  get recording(): boolean {
    return this.proc !== null;
  }

  static available(): { ok: boolean; why?: string } {
    if (!secret("DEEPGRAM_API_KEY")) return { ok: false, why: "DEEPGRAM_API_KEY is not set" };
    return { ok: true };
  }

  start(): void {
    if (this.proc) return;
    this.chunks = [];
    this.error = null;
    const proc = spawn("rec", ["-q", "-t", "raw", "-r", String(SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"], {
      env: childEnv(),
    });
    proc.stdout.on("data", (d: Buffer) => this.chunks.push(d));
    proc.stderr.on("data", (d) => (this.error = String(d)));
    proc.on("error", (err) => (this.error = err.message.includes("ENOENT") ? "sox is not installed (brew install sox)" : err.message));
    this.proc = proc;
  }

  /** Stops recording and returns the transcript ("" when nothing was said). */
  async stop(): Promise<string> {
    const proc = this.proc;
    if (!proc) return "";
    this.proc = null;
    await new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
      proc.kill("SIGINT");
      setTimeout(resolve, 1500);
    });
    const pcm = Buffer.concat(this.chunks);
    if (pcm.length < SAMPLE_RATE * 2 * 0.3) {
      if (this.error) throw new Error(this.error);
      return "";
    }
    return transcribe(pcm);
  }
}

async function transcribe(pcm: Buffer): Promise<string> {
  const key = secret("DEEPGRAM_API_KEY");
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const params = new URLSearchParams({ model: "nova-3", smart_format: "true", language: secret("DEEPGRAM_LANGUAGE") || "en" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
    body: new Uint8Array(wav(pcm)),
  });
  if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
