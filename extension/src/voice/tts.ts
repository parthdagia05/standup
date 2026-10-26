import { ChildProcess, spawn } from "node:child_process";
import { AgentName, bus } from "../bus";
import { childEnv, config, secret } from "../config";
import { voiceFor } from "./voices";

interface Utterance {
  agent: AgentName;
  text: string;
  urgent: boolean;
  /** Conversation between agents: never dropped, or the dialogue stops making sense. */
  keep: boolean;
}

const SAMPLE_RATE = 24000;

/**
 * One voice at a time, first in first out. Decision questions jump the queue.
 * Narration is dropped when it piles up, so voices never fall minutes behind.
 */
class SpeechQueue {
  private queue: Utterance[] = [];
  private current: ChildProcess | null = null;
  private busy = false;
  private muted = false;
  private introduced = new Set<AgentName>();

  say(agent: AgentName, text: string, urgent = false, keep = false): void {
    if (config.voice() === "off") return;
    if (!this.introduced.has(agent) && !keep) {
      this.introduced.add(agent);
      text = `${voiceFor(agent).label} here. ${text}`;
    }
    this.introduced.add(agent);
    const item = { agent, text, urgent, keep };
    if (urgent) {
      const firstNormal = this.queue.findIndex((u) => !u.urgent);
      this.queue.splice(firstNormal === -1 ? this.queue.length : firstNormal, 0, item);
    } else {
      // Keep at most 3 pending narration lines; the oldest are stale anyway.
      const narration = this.queue.filter((u) => !u.urgent && !u.keep);
      if (!keep && narration.length >= 3) this.queue.splice(this.queue.indexOf(narration[0]), 1);
      this.queue.push(item);
    }
    void this.pump();
  }

  /** Stop the current line and hold playback (used while you're talking). */
  mute(): void {
    this.muted = true;
    this.current?.kill("SIGKILL");
  }

  unmute(): void {
    this.muted = false;
    void this.pump();
  }

  stopAll(): void {
    this.queue = [];
    this.current?.kill("SIGKILL");
  }

  resetIntroductions(): void {
    this.introduced.clear();
  }

  private async pump(): Promise<void> {
    if (this.busy || this.muted) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    bus.emit({ type: "speaking", agent: next.agent });
    try {
      await this.play(next);
    } catch (err) {
      bus.emit({ type: "log", level: "warn", text: `TTS failed: ${(err as Error).message}` });
    } finally {
      this.current = null;
      this.busy = false;
      bus.emit({ type: "speaking", agent: null });
      void this.pump();
    }
  }

  private async play(u: Utterance): Promise<void> {
    const mode = config.voice();
    const voice = voiceFor(u.agent);
    const key = secret("CARTESIA_API_KEY");
    if ((mode === "cartesia" || mode === "auto") && key && voice.cartesiaId) {
      try {
        const pcm = await cartesia(u.text, voice.cartesiaId, key);
        return await this.run("play", ["-q", "-t", "raw", "-r", String(SAMPLE_RATE), "-e", "signed", "-b", "16", "-c", "1", "-"], pcm);
      } catch (err) {
        bus.emit({ type: "log", level: "warn", text: `Cartesia failed, using macOS voice: ${(err as Error).message}` });
      }
    }
    await this.run("say", ["-v", voice.sayVoice, "-r", "205", u.text]).catch(() => this.run("say", [u.text]));
  }

  private run(cmd: string, args: string[], stdin?: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { env: childEnv(), stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
      this.current = proc;
      let stderr = "";
      proc.stderr?.on("data", (d) => (stderr += d));
      proc.on("error", reject);
      proc.on("close", (code, signal) => {
        if (code === 0 || signal) resolve();
        else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 200)}`));
      });
      if (stdin) {
        proc.stdin?.on("error", () => {});
        proc.stdin?.end(stdin);
      }
    });
  }
}

async function cartesia(text: string, voiceId: string, apiKey: string): Promise<Buffer> {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": secret("CARTESIA_VERSION") || "2025-04-16",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: secret("CARTESIA_MODEL") || "sonic-2",
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
      language: "en",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

export const speech = new SpeechQueue();
