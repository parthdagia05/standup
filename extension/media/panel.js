// @ts-check
// Mission Control: renders the team on an SVG stage and keeps the decision
// dock and live feed in sync with bus events from the extension.
const vscode = acquireVsCodeApi();
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const SVG = "http://www.w3.org/2000/svg";
const CX = 400;
const CY = 262;

/** @type {Map<string, {id:string,label:string,kind:string,color:string,owns:string[]}>} */
const agents = new Map();
/** @type {Map<string, {x:number,y:number}>} */
const pos = new Map();
const status = new Map();
/** @type {Map<string, any>} */
const decisions = new Map();
const bubbleTimers = new Map();
let runStart = 0;
let clockTimer = 0;
let speaking = null;

const VIA = { voice: "🎙 voice", phone: "📞 phone", click: "🖱 click" };

window.addEventListener("message", ({ data }) => {
  if (data.type === "init") {
    setTeam(data.agents, true);
    setMode(data.mode);
    renderSystems(data.status);
    for (const e of data.history) handle(e, true);
  } else if (data.type === "event") handle(data.event, false);
});

/** @param {any} e @param {boolean} replay */
function handle(e, replay) {
  switch (e.type) {
    case "run.started":
      resetRun(e.feature, replay ? Date.now() : Date.now());
      feed({ from: "you", text: e.feature, kind: "you" });
      break;
    case "team.formed":
      setTeam(e.members, replay);
      break;
    case "speak":
      feed({ from: e.agent, to: "you", text: e.text });
      if (!replay) bubble(e.agent, e.text);
      break;
    case "user.said":
      feed({ from: "you", text: e.text, kind: "you" });
      break;
    case "agent.message":
      feed({ from: e.from, to: e.to, text: e.text, kind: "msg" });
      if (!replay) {
        beam(e.from, e.to);
        if (e.text.length < 220 && !e.text.startsWith("Contract:")) bubble(e.from, e.text, e.to);
      }
      break;
    case "decision.requested":
      addDecision(e);
      break;
    case "decision.answered":
      answerDecision(e);
      break;
    case "agent.status":
      setStatus(e.agent, e.status, e.detail);
      break;
    case "file.changed":
      if (!replay) chip(e.agent, e.path);
      break;
    case "speaking":
      speaking = e.agent;
      document.querySelectorAll(".node").forEach((n) => n.classList.toggle("speaking", n.getAttribute("data-agent") === e.agent));
      break;
    case "listening":
      $("ptt").classList.toggle("rec", e.on);
      $("feature").placeholder = e.on ? "Listening… press ⌘⇧Space again to send" : "What should the team build?";
      break;
    case "mode.changed":
      setMode(e.mode);
      break;
    case "phone.status":
      phoneStatus(e);
      break;
    case "run.finished":
      finish(e);
      break;
    case "log":
      if (e.level !== "info") feed({ from: "sys", text: e.text, kind: "sys" });
      break;
  }
}

// ---------- team & stage ----------

function setTeam(members, quiet) {
  const before = new Set(agents.keys());
  agents.clear();
  for (const m of members) agents.set(m.id, m);
  layout();
  renderStage(quiet ? new Set(agents.keys()) : before);
}

function layout() {
  pos.clear();
  pos.set("lead", { x: CX, y: CY });
  const workers = [...agents.values()].filter((a) => a.id !== "lead");
  const n = workers.length;
  const start = n === 2 ? 180 : -90;
  workers.forEach((w, i) => {
    const a = ((start + (i * 360) / n) * Math.PI) / 180;
    pos.set(w.id, { x: CX + Math.cos(a) * 270, y: CY + Math.sin(a) * 178 });
  });
}

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

/** @param {Set<string>} existing ids that shouldn't animate in */
function renderStage(existing) {
  const grid = $("grid");
  grid.innerHTML = "";
  const spin = el("g", { class: "orbit-spin" }, grid);
  for (const r of [120, 200, 300]) el("circle", { cx: CX, cy: CY, r }, spin);
  el("line", { x1: 40, y1: CY, x2: 760, y2: CY }, grid);
  el("line", { x1: CX, y1: 30, x2: CX, y2: 520 }, grid);

  const links = $("links");
  links.innerHTML = "";
  const nodes = $("nodes");
  nodes.innerHTML = "";

  for (const a of agents.values()) {
    const p = pos.get(a.id);
    if (!p) continue;
    if (a.id !== "lead") el("path", { class: "link", d: curve(pos.get("lead"), p) }, links);
    const g = el("g", { class: "node" + (existing.has(a.id) ? "" : " enter"), "data-agent": a.id, transform: `translate(${p.x} ${p.y})`, style: `--c:${a.color}` }, nodes);
    g.setAttribute("data-status", status.get(a.id)?.status ?? "idle");
    if (a.id === speaking) g.classList.add("speaking");
    if (a.id === "lead") drawLead(g);
    else drawWorker(g, a);
    const s = status.get(a.id);
    if (s) setStatus(a.id, s.status, s.detail);
  }

  if (agents.size === 1) {
    const t = el("text", { class: "hint-text", x: CX, y: CY + 128 }, nodes);
    t.textContent = runStart ? "LEAD IS SIZING UP THE MISSION…" : "TEAM ON STANDBY";
  }
  refreshBadges();
}

function drawLead(g) {
  g.classList.add("core");
  el("circle", { class: "glow", r: 96 }, g);
  el("circle", { class: "halo", r: 70, fill: "#f2b84b", filter: "url(#blur)", opacity: 0 }, g);
  el("circle", { class: "spin1", r: 66 }, g);
  el("circle", { class: "spin2", r: 56 }, g);
  el("circle", { class: "ring", r: 48 }, g);
  el("circle", { class: "orb", r: 40 }, g);
  const t = el("text", { class: "mono", y: 0 }, g);
  t.textContent = "LEAD";
  t.setAttribute("style", "font-size:13px;letter-spacing:.24em;fill:#f2b84b");
  drawWave(g, -78);
  const d = el("text", { class: "detail", y: 88 }, g);
  d.setAttribute("data-role", "detail");
}

function drawWorker(g, a) {
  el("circle", { class: "halo", r: 56, fill: a.color, filter: "url(#blur)" }, g);
  el("circle", { class: "ring", r: 42 }, g);
  el("circle", { class: "disc", r: 34 }, g);
  const m = el("text", { class: "mono" }, g);
  m.textContent = initials(a.label);
  const name = el("text", { class: "name", y: 62 }, g);
  name.textContent = a.label.toUpperCase();
  const kind = el("text", { class: "kind", y: 76 }, g);
  const owns = a.owns.join(", ");
  kind.textContent = shorten(owns && owns.toLowerCase() !== a.kind ? `${a.kind} · ${owns}` : a.kind, 34);
  const d = el("text", { class: "detail", y: 92 }, g);
  d.setAttribute("data-role", "detail");
  drawWave(g, -60);
}

function drawWave(g, y) {
  const w = el("g", { class: "wave", transform: `translate(-17 ${y})` }, g);
  [0, 7, 14, 21, 28].forEach((x, i) => {
    const r = el("rect", { x, y: -8, width: 4, height: 16, rx: 2 }, w);
    r.setAttribute("style", `animation-delay:${(i % 3) * 0.13 + i * 0.05}s`);
  });
}

function initials(label) {
  const parts = label.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2)).toUpperCase();
}

function curve(a, b) {
  // Bend every link gently away from the center so beams don't overlap.
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.18);
  return `M${a.x},${a.y} Q${mx - (dy / len) * bend},${my + (dx / len) * bend} ${b.x},${b.y}`;
}

function nodeEl(id) {
  return /** @type {SVGGElement|null} */ (document.querySelector(`.node[data-agent="${CSS.escape(id)}"]`));
}

function setStatus(id, s, detail) {
  status.set(id, { status: s, detail });
  const n = nodeEl(id);
  if (!n) return;
  n.setAttribute("data-status", s);
  const d = n.querySelector('[data-role="detail"]');
  if (d) d.textContent = shorten(detail ? `${label(s)} · ${detail}` : label(s), 40);
}

function label(s) {
  return { idle: "standing by", thinking: "thinking", working: "working", waiting: "needs you", done: "done ✓", error: "hit a problem" }[s] ?? s;
}

function beam(from, to) {
  const targets = to === "team" ? [...agents.keys()].filter((id) => id !== from && id !== "lead") : [to];
  const a = agents.get(from);
  for (const t of targets) {
    const p1 = pos.get(from), p2 = pos.get(t);
    if (!p1 || !p2 || !a) continue;
    const d = curve(p1, p2);
    const path = el("path", { class: "link hot", d, stroke: a.color }, $("links"));
    const dot = el("circle", { r: 5, fill: a.color, class: "beam", style: `color:${a.color}` }, $("beams"));
    const motion = el("animateMotion", { dur: "0.9s", path: d, fill: "freeze" }, dot);
    // @ts-ignore beginElement exists on SVG animation elements
    motion.beginElement?.();
    setTimeout(() => dot.remove(), 1000);
    setTimeout(() => path.remove(), 1900);
  }
}

function bubble(id, text, to) {
  const p = pos.get(id);
  const a = agents.get(id);
  if (!p || !a) return;
  bubbleTimers.get(id)?.forEach(clearTimeout);
  document.querySelector(`.bubble[data-agent="${CSS.escape(id)}"]`)?.remove();
  const w = 220, h = 96;
  // Keep bubbles off the nodes: the Lead talks into the empty upper-left
  // quadrant, nodes on the vertical axis talk to their side, the rest above.
  let x, y, align = "flex-end";
  if (id === "lead") {
    x = CX - 300;
    y = CY - 200;
  } else if (Math.abs(p.x - CX) < 80) {
    x = p.x + 54;
    y = p.y - h / 2;
    align = "center";
  } else {
    x = p.x - w / 2;
    y = p.y - 58 - h;
  }
  x = Math.max(6, Math.min(800 - w - 6, x));
  y = Math.max(4, Math.min(560 - h - 4, y));
  const fo = el("foreignObject", { class: "bubble", "data-agent": id, x, y, width: w, height: h, style: `--c:${a.color}` }, $("bubbles"));
  const wrap = document.createElement("div");
  wrap.setAttribute("style", `height:${h}px;display:flex;flex-direction:column;justify-content:${align}`);
  const b = document.createElement("div");
  b.className = "bb";
  const head = document.createElement("b");
  head.textContent = to && to !== "you" ? `${a.label.toUpperCase()} → ${(agents.get(to)?.label ?? to).toUpperCase()}` : a.label.toUpperCase();
  b.append(head, document.createTextNode(text));
  wrap.appendChild(b);
  fo.appendChild(wrap);
  const t1 = setTimeout(() => fo.classList.add("out"), Math.min(9000, 2600 + text.length * 45));
  const t2 = setTimeout(() => fo.remove(), Math.min(9400, 3000 + text.length * 45));
  bubbleTimers.set(id, [t1, t2]);
}

function chip(id, path) {
  const p = pos.get(id);
  const a = agents.get(id);
  if (!p || !a) return;
  const t = el("text", { class: "chip", x: p.x + 46, y: p.y - 18, style: `--c:${a.color}` }, $("bubbles"));
  t.textContent = `✎ ${path.split("/").pop()}`;
  setTimeout(() => t.remove(), 2700);
}

function refreshBadges() {
  document.querySelectorAll(".node .badge, .node .badge-t").forEach((b) => b.remove());
  for (const d of decisions.values()) {
    if (d.done) continue;
    const n = nodeEl(d.agent);
    if (!n || n.querySelector(".badge")) continue;
    const r = d.agent === "lead" ? 34 : 28;
    el("circle", { class: "badge", cx: r, cy: -r, r: 9 }, n);
    const t = el("text", { class: "badge-t", x: r, y: -r }, n);
    t.textContent = "?";
  }
}

// ---------- decisions ----------

function addDecision(e) {
  const body = $("dockBody");
  body.querySelector(".quiet")?.remove();
  const card = document.createElement("div");
  card.className = "dcard pending";
  card.style.setProperty("--c", color(e.agent));
  const who = document.createElement("div");
  who.className = "who";
  who.innerHTML = `<span class="from"></span><span class="reason"></span>`;
  who.children[0].textContent = name(e.agent).toUpperCase();
  who.children[1].textContent = `· ${e.reason}`;
  const q = document.createElement("div");
  q.className = "q";
  q.textContent = e.question;
  const opts = document.createElement("div");
  opts.className = "opts";
  e.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.innerHTML = `<kbd></kbd><span></span>`;
    b.children[0].textContent = String(i + 1);
    b.children[1].textContent = opt;
    b.onclick = () => vscode.postMessage({ type: "answer", id: e.id, choice: opt });
    opts.appendChild(b);
  });
  const say = document.createElement("div");
  say.className = "say";
  say.textContent = "…or just say it: ⌘⇧Space";
  card.append(who, q, opts, say);
  body.prepend(card);
  decisions.set(e.id, { ...e, card, done: false });
  updateCounts();
  refreshBadges();
  // In narrow panels the dock sits below the stage; bring the question into view.
  if (window.innerWidth <= 900) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function answerDecision(e) {
  const d = decisions.get(e.id);
  if (!d) return;
  d.done = true;
  d.via = e.via;
  const card = d.card;
  card.className = "dcard done";
  card.innerHTML = "";
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = name(d.agent).toUpperCase();
  const q = document.createElement("div");
  q.className = "q";
  q.textContent = d.question;
  const a = document.createElement("div");
  a.innerHTML = `<span class="chose"></span><span class="via"></span>`;
  a.children[0].textContent = `→ ${e.choice}`;
  a.children[1].textContent = VIA[e.via] ?? e.via;
  card.append(who, q, a);
  // Answered cards sink below anything still pending.
  $("dockBody").appendChild(card);
  updateCounts();
  refreshBadges();
}

function phoneStatus(e) {
  feed({ from: "sys", text: `📞 ${e.status}`, kind: "sys" });
  const d = e.decisionId && decisions.get(e.decisionId);
  if (!d || d.done) return;
  let line = d.card.querySelector(".phone");
  if (!line) {
    line = document.createElement("div");
    line.className = "phone";
    d.card.appendChild(line);
  }
  const ringing = /calling|ringing/.test(e.status);
  line.innerHTML = ringing ? `<i>📞</i><span></span>` : `<span></span>`;
  line.lastElementChild.textContent = ringing ? `${e.status === "calling" ? "Calling" : "Ringing"} your phone…` : e.status;
}

function updateCounts() {
  const all = [...decisions.values()];
  const open = all.filter((d) => !d.done).length;
  $("pendingCount").textContent = open ? `${open} WAITING` : "";
  const answered = all.filter((d) => d.done);
  const byPhone = answered.filter((d) => d.via === "phone").length;
  const byVoice = answered.filter((d) => d.via === "voice").length;
  $("history").textContent = answered.length ? `${answered.length} DECISION${answered.length > 1 ? "S" : ""} · ${byVoice} 🎙 · ${byPhone} 📞` : "";
}

// ---------- feed ----------

function feed({ from, to, text, kind = "" }) {
  const f = $("feed");
  f.querySelector(".quiet")?.remove();
  const row = document.createElement("div");
  row.className = `ln ${kind}`;
  row.style.setProperty("--c", from === "you" ? "var(--cyan)" : color(from));
  if (to && to !== "you") row.style.setProperty("--c2", color(to));
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = stamp();
  const h = document.createElement("span");
  h.className = "h";
  const fromEl = document.createElement("span");
  fromEl.className = "from";
  fromEl.textContent = from === "you" ? "YOU" : from === "sys" ? "SYSTEM" : name(from).toUpperCase();
  h.appendChild(fromEl);
  if (to && to !== "you") {
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    const toEl = document.createElement("span");
    toEl.className = "to";
    toEl.textContent = to === "team" ? "TEAM" : name(to).toUpperCase();
    h.append(arrow, toEl);
  }
  const x = document.createElement("span");
  x.className = "x";
  x.textContent = shorten(text, 420);
  row.append(t, h, x);
  f.appendChild(row);
  while (f.children.length > 250) f.firstElementChild?.remove();
  f.scrollTop = f.scrollHeight;
}

// ---------- run lifecycle ----------

function resetRun(feature, start) {
  runStart = start;
  status.clear();
  decisions.clear();
  $("feed").innerHTML = "";
  $("dockBody").innerHTML = "";
  $("summary").hidden = true;
  $("mission").textContent = feature;
  $("mission").title = feature;
  setLive("live", "LIVE");
  clearInterval(clockTimer);
  tick();
  clockTimer = setInterval(tick, 1000);
  updateCounts();
}

function finish(e) {
  clearInterval(clockTimer);
  setLive(e.ok ? "done" : "stopped", e.ok ? "COMPLETE" : "STOPPED");
  if (e.summary) {
    $("summaryText").textContent = e.summary;
    $("summary").hidden = false;
  }
  if (!$("dockBody").children.length) $("dockBody").innerHTML = `<p class="quiet">No decisions were needed.</p>`;
}

function setLive(state, text) {
  $("live").setAttribute("data-state", state);
  $("liveText").textContent = text;
}

function tick() {
  $("clock").textContent = stamp();
}

function stamp() {
  if (!runStart) return "00:00";
  const s = Math.max(0, Math.floor((Date.now() - runStart) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- chrome ----------

function setMode(mode) {
  $("modeDesk").classList.toggle("on", mode === "desk");
  $("modeAway").classList.toggle("on", mode === "away");
}

function renderSystems(s) {
  const ul = $("status");
  ul.innerHTML = "";
  for (const [k, v] of Object.entries(s)) {
    const li = document.createElement("li");
    const ok = !/^(missing|off|not)/i.test(String(v));
    if (!ok) li.className = "no";
    li.title = `${k}: ${v}`;
    li.innerHTML = `<b></b><span><em></em> </span>`;
    li.querySelector("em").textContent = k;
    li.querySelector("span").append(shorten(String(v), 30));
    ul.appendChild(li);
  }
}

function name(id) {
  return agents.get(id)?.label ?? (id === "lead" ? "Lead" : id);
}
function color(id) {
  return agents.get(id)?.color ?? "#7f8bb3";
}
function shorten(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

$("startForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($("feature"));
  const text = input.value.trim();
  if (!text) return;
  vscode.postMessage({ type: "start", text });
  input.value = "";
});
$("modeDesk").onclick = () => vscode.postMessage({ type: "mode", mode: "desk" });
$("modeAway").onclick = () => vscode.postMessage({ type: "mode", mode: "away" });
$("ptt").onclick = () => vscode.postMessage({ type: "ptt" });
$("stop").onclick = () => vscode.postMessage({ type: "stop" });

// 1-4 answers the oldest waiting decision, unless you're typing.
document.addEventListener("keydown", (ev) => {
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;
  const n = Number(ev.key);
  if (!n || n > 4) return;
  const open = [...decisions.values()].find((d) => !d.done);
  if (open && open.options[n - 1]) vscode.postMessage({ type: "answer", id: open.id, choice: open.options[n - 1] });
});

setTeam([{ id: "lead", label: "Lead", kind: "lead", color: "#f2b84b", owns: [] }], true);
vscode.postMessage({ type: "ready" });
