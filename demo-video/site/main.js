const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const $ = (id) => document.getElementById(id);

// ---- generated content ----
const MESSY = [
  ["Screenshot 2026-10-23 at 1.42.59 PM.png", "png"], ["IMG_4421.mov", "mov"], ["resume.pdf", "pdf"], ["resume (1).pdf", "pdf"], ["Untitled.zip", "zip"],
  ["invoice_final_FINAL2.pdf", "pdf"], ["Screenshot 2026-10-23 at 1.46.15 PM.png", "png"], ["notes.txt", "txt"], ["new folder.zip", "zip"], ["resume (2).pdf", "pdf"],
  ["assignment_v3.docx", "doc"], ["Screenshot 2026-10-24 at 2.14.50 AM.png", "png"], ["IMG_4422.mov", "mov"], ["boarding pass.pdf", "pdf"], ["resume (3).pdf", "pdf"],
  ["download.zip", "zip"], ["Screenshot 2026-10-25 at 5.21.36 PM.png", "png"], ["final_final_REAL.docx", "doc"], ["Screenshot 2026-10-26 at 5.00.25 PM.png", "png"], ["Screenshot 2026-10-28 at 4.10.32 PM.png", "png"],
];
const KIND = { png: "#4f86e8", mov: "#8a63d2", pdf: "#e5534b", zip: "#d6a23a", txt: "#7d8f99", doc: "#2d6cdf" };
MESSY.forEach(([name, kind], i) => {
  const d = document.createElement("div");
  d.className = "tile";
  d.dataset.at = (0.5 + ((i * 7) % 20) * 0.13).toFixed(2);
  d.dataset.dur = "0.3";
  d.dataset.fx = "pop";
  d.innerHTML = `<div class="ic" style="background:${KIND[kind]}">${kind.toUpperCase()}</div><span></span>`;
  d.querySelector("span").textContent = name;
  $("messy").appendChild(d);
});
const SORTED = [["🖼", "Images", "7 items"], ["📄", "PDFs", "3 items"], ["🎞", "Videos", "2 items"], ["🗜", "Archives", "3 items"], ["📝", "Docs", "2 items"], ["📃", "roast.txt", "new"]];
SORTED.forEach(([ic, name, n], i) => {
  const d = document.createElement("div");
  d.className = "row";
  d.dataset.at = (32.5 + i * 0.28).toFixed(2);
  d.dataset.dur = "0.3";
  d.innerHTML = `<span class="fi">${ic}</span><span>${name}</span><em>${n}</em>`;
  $("sorted").appendChild(d);
});
const wave = $("wave");
for (let i = 0; i < 20; i++) wave.appendChild(document.createElement("i"));
const ROAST = `ROAST.TXT

Three copies of your resume. "resume (3)" isn't a version, it's a cry for help.

Seven screenshots you never opened again.

It's all sorted now. You're welcome.`;

// ---- renderer ----
const scenes = [...document.querySelectorAll(".scene")];
const fxEls = [...document.querySelectorAll("[data-at]")].filter((el) => !el.dataset.type);
const frames = [...document.querySelectorAll(".pframe")];
const cards = [...document.querySelectorAll("[data-active]")];
const bars = [...wave.children];
let lastCap = -2;

function applyFx(el, t) {
  const at = +el.dataset.at;
  const dur = +(el.dataset.dur || 0.5);
  const until = el.dataset.until ? +el.dataset.until : Infinity;
  let p = ease((t - at) / dur);
  if (t > until) p = Math.min(p, 1 - ease((t - until) / 0.3));
  const kind = el.dataset.fx || "up";
  if (kind === "draw") {
    el.style.strokeDashoffset = String(1 - p);
    el.style.opacity = p > 0 ? "1" : "0";
    if (el.dataset.both) el.setAttribute("marker-start", "url(#ahw)");
    return;
  }
  el.style.opacity = String(p);
  const tf = { up: `translateY(${(1 - p) * 18}px)`, pop: `scale(${0.88 + 0.12 * p})`, left: `translateX(${(1 - p) * -34}px)`, right: `translateX(${(1 - p) * 60}px)`, none: "" }[kind];
  el.style.transform = tf;
}

window.render = (t) => {
  for (const s of scenes) {
    const from = +s.dataset.from, to = +s.dataset.to;
    let o = 0;
    if (t >= from && t < to) o = Math.min(from === 0 ? 1 : ease((t - from) / 0.35), ease((to - t) / 0.35));
    s.style.opacity = String(o);
    s.style.visibility = o > 0 ? "visible" : "hidden";
    if (o > 0 && !s.dataset.noburn) s.style.transform = `scale(${1 + 0.022 * clamp((t - from) / (to - from))})`;
  }
  for (const el of fxEls) applyFx(el, t);

  // Typewriter for the roast.
  const r = $("roast");
  r.textContent = ROAST.slice(0, Math.max(0, Math.floor((t - 32.9) * 48)));

  for (const c of cards) {
    const [a, b] = c.dataset.active.split(",").map(Number);
    c.classList.toggle("on", t >= a && t < b);
  }

  // Window slides over to make room for the phone while the call lasts.
  const slide = ease((t - 27.2) / 0.7) - ease((t - 31.3) / 0.7);
  $("win2").style.transform = `translateX(${-40 * slide}px) scale(${1 - 0.16 * slide})`;
  $("sbmode").textContent = t >= 25.4 ? "📞 Standup: Away" : "🎙 Standup: Desk";

  // Phone: ringing rings, call timer and waveform.
  const ring = document.querySelector(".rings");
  const f = (t * 1.1) % 1;
  ring.style.transform = `scale(${1 + 0.35 * f})`;
  ring.style.opacity = String(1 - f);
  const secs = Math.max(0, Math.floor(t - 28.6));
  $("timer").textContent = `00:0${Math.min(secs, 9)}`;
  const talking = (t > 28.7 && t < 29.3) || (t > 29.3 && t < 31) ? 1 : 0.15;
  bars.forEach((b, i) => (b.style.height = `${8 + 40 * talking * Math.abs(Math.sin(t * 9 + i * 0.8)) * (0.5 + 0.5 * Math.sin(i * 0.5 + t))}px`));

  // Access toggle.
  const k = ease((t - 121.0) / 0.5);
  $("knob").style.transform = `translateX(${k * 256}px)`;

  $("chapter").textContent = t < 37.5 ? "1 · The demo" : t < 142.3 ? "2 · How it's built" : t < 198.7 ? "3 · What's next" : "";
  $("tag").style.opacity = t > 0.4 && t < 37.4 ? "1" : "0";

  // Captions.
  const idx = CAPTIONS.findIndex(([a, b]) => t >= a && t < b);
  if (idx !== lastCap) {
    lastCap = idx;
    $("cap").innerHTML = idx < 0 ? "" : `<span></span>`;
    if (idx >= 0) $("cap").firstChild.textContent = CAPTIONS[idx][2];
  }

  for (const fr of frames) if (t >= +fr.dataset.from && fr.contentWindow.__advance) fr.contentWindow.__advance(t);
};
window.__ready = () => frames.every((f) => f.contentWindow && f.contentWindow.__ready);
