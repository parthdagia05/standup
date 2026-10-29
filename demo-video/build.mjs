// Renders the demo video: steps the page's clock frame by frame (so it is perfectly in sync), then muxes the voice track and sound effects.
// Usage: node build.mjs "<voice.m4a>" [output.mp4]
import fs from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

const voice = process.argv[2];
const output = process.argv[3] ?? "out/standup-demo.mp4";
if (!voice || !fs.existsSync(voice)) throw new Error('Pass the voice file: node build.mjs "<voice.m4a>" [output.mp4]');

const FPS = 30;
const DURATION = 208;
const FRAMES = DURATION * FPS;
fs.mkdirSync("out", { recursive: true });

// ---- 1. frames ----
const { server, port } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__ready && window.__ready());

const silent = "out/silent.mp4";
const enc = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res) => enc.on("close", res));
const started = Date.now();
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once("drain", r));
  if (i % 300 === 0) console.log(`frame ${i}/${FRAMES}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
enc.stdin.end();
await done;
await browser.close();
server.close();

// ---- 2. audio: your voice plus a few quiet sound effects ----
const tone = (t, freqs, dur, vol) => ({ t, freqs, dur, vol });
const SFX = [
  tone(8.85, [1200], 0.09, 0.1), // push-to-talk on
  tone(13.45, [800], 0.09, 0.1), // push-to-talk off
  tone(27.6, [440, 480], 0.4, 0.13), // phone ring
  tone(28.1, [440, 480], 0.4, 0.13),
  tone(28.6, [600], 0.06, 0.1), // call answered
  tone(30.95, [988], 0.2, 0.12), // decision received
  tone(31.1, [1319], 0.28, 0.12),
  tone(31.55, [659], 0.2, 0.09), // all done
  tone(31.65, [880], 0.2, 0.09),
  tone(31.75, [1319], 0.35, 0.09),
];
const inputs = ["-i", silent, "-i", voice];
const filters = ["[1:a]highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,apad[v]"];
const labels = ["[v]"];
let n = 2;
for (const s of SFX) {
  const parts = s.freqs.map((f) => `sine=f=${f}:d=${s.dur}:sample_rate=48000`);
  parts.forEach((p) => inputs.push("-f", "lavfi", "-i", p));
  const idx = s.freqs.map((_, k) => n + k);
  n += s.freqs.length;
  const mix = idx.length > 1 ? `${idx.map((i) => `[${i}:a]`).join("")}amix=inputs=${idx.length}:normalize=0,` : `[${idx[0]}:a]`;
  const label = `[s${labels.length}]`;
  filters.push(`${mix}afade=t=out:st=${(s.dur * 0.55).toFixed(3)}:d=${(s.dur * 0.45).toFixed(3)},volume=${s.vol},adelay=${Math.round(s.t * 1000)}|${Math.round(s.t * 1000)}${label}`);
  labels.push(label);
}
filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(DURATION), "-movflags", "+faststart", output], { stdio: "inherit" });
console.log("wrote", output);
