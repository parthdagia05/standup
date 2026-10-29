// node shot.mjs 5 14 28 ...  -> out/still-<t>.png, for checking scenes without rendering the whole video.
import fs from "node:fs";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

const times = process.argv.slice(2).map(Number);
fs.mkdirSync("out", { recursive: true });
const { server, port } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const t of times) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__ready && window.__ready());
  await page.evaluate((t) => window.render(t), t);
  await page.screenshot({ path: `out/still-${t}.png` });
  await page.close();
}
await browser.close();
server.close();
