// @ts-check
const vscode = acquireVsCodeApi();
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {Record<string, {id:string,label:string,color:string}>} */
let agents = {};
/** @type {Record<string, {question:string, options:string[], agent:string, el:HTMLElement}>} */
const decisions = {};
const files = {};
/** Last status per agent, so cards keep it when the team changes. */
const statuses = {};

const VIA = { voice: "🎙 voice", phone: "📞 phone", click: "🖱 click" };
const EMPTY = {
  cards: "The lead hires a team that fits your repo as soon as you start a feature.",
  transcript: "Nothing yet. Start a feature to hear the team.",
  decisions: "The team will ask you here only when it matters.",
};

window.addEventListener("message", ({ data }) => {
  if (data.type === "init") {
    agents = Object.fromEntries(data.agents.map((a) => [a.id, a]));
    renderCards();
    setMode(data.mode);
    setRunning(false);
    renderStatus(data.status);
    for (const e of data.history) handle(e, true);
  } else if (data.type === "event") handle(data.event, false);
  else if (data.type === "status") renderStatus(data.status);
});

function handle(e, replay) {
  switch (e.type) {
    case "speak":
      line(e.agent, e.text);
      break;
    case "user.said":
      line("you", e.text, "you");
      break;
    case "agent.message":
      line(e.from, `${label(e.to)}: ${e.text}`, "msg");
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
      addFile(e.agent, e.path);
      break;
    case "speaking":
      document.querySelectorAll(".card").forEach((c) => c.classList.toggle("speaking", c.dataset.agent === e.agent));
      break;
    case "listening":
      $("ptt").classList.toggle("rec", e.on);
      $("ptt").firstChild.textContent = e.on ? "Listening… press again " : "🎙 Talk ";
      break;
    case "mode.changed":
      setMode(e.mode);
      break;
    case "phone.status":
      line("sys", `📞 ${e.status}`, "sys");
      break;
    case "team.formed":
      agents = Object.fromEntries(e.members.map((a) => [a.id, a]));
      renderCards();
      break;
    case "run.started":
      resetRun();
      setRunning(true);
      line("you", e.feature, "you");
      break;
    case "run.finished":
      setRunning(false, e.ok ? "done" : "stopped");
      break;
    case "log":
      if (e.level !== "info") line("sys", e.text, "sys");
      break;
  }
}

function label(agent) {
  return agents[agent]?.label ?? (agent === "team" ? "Team" : agent);
}
function color(agent) {
  return agents[agent]?.color ?? "var(--fg)";
}

function setEmpty(id) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = EMPTY[id];
  $(id).replaceChildren(p);
}

function setRunning(on, final = "idle") {
  const state = $("runState");
  state.textContent = on ? "running" : final;
  state.className = `run-state ${on ? "live" : final}`;
  $("stop").disabled = !on;
  /** @type {HTMLButtonElement} */ ($("startBtn")).disabled = on;
}

function renderCards() {
  $("cards").innerHTML = "";
  if (!Object.keys(agents).length) setEmpty("cards");
  for (const a of Object.values(agents)) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.agent = a.id;
    card.style.setProperty("--c", a.color);
    card.innerHTML = `<div class="name"><span class="dot"></span><span class="label"></span></div><div class="state">idle</div><div class="files"></div>`;
    card.querySelector(".label").textContent = a.label;
    $("cards").appendChild(card);
    const s = statuses[a.id];
    if (s) setStatus(a.id, s.status, s.detail);
    for (const p of files[a.id] ?? []) appendFile(card, p);
  }
}

function card(agent) {
  return /** @type {HTMLElement|null} */ (document.querySelector(`.card[data-agent="${agent}"]`));
}

function setStatus(agent, status, detail) {
  statuses[agent] = { status, detail };
  const c = card(agent);
  if (!c) return;
  c.querySelector(".dot").className = `dot ${status}`;
  c.querySelector(".state").textContent = detail ? `${status} · ${detail}` : status;
}

function addFile(agent, path) {
  files[agent] ??= new Set();
  if (files[agent].has(path)) return;
  files[agent].add(path);
  const c = card(agent);
  if (c) appendFile(c, path);
}

function appendFile(c, path) {
  const d = document.createElement("div");
  d.textContent = `✎ ${path}`;
  d.title = path;
  c.querySelector(".files").appendChild(d);
}

function line(who, text, kind = "") {
  const t = $("transcript");
  t.querySelector(".empty")?.remove();
  const stick = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
  const row = document.createElement("div");
  row.className = `line ${kind}`;
  row.style.setProperty("--c", who === "you" ? "var(--fg)" : color(who));
  const w = document.createElement("span");
  w.className = "who";
  w.textContent = who === "you" ? "You" : who === "sys" ? "system" : label(who);
  const x = document.createElement("span");
  x.className = "text";
  x.textContent = text;
  row.append(w, x);
  t.appendChild(row);
  if (stick) t.scrollTop = t.scrollHeight;
}

function addDecision(e) {
  $("decisions").querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = "decision pending";
  el.style.setProperty("--c", color(e.agent));
  el.innerHTML = `<div class="meta"></div><div class="q"></div><div class="opts"></div>`;
  el.querySelector(".meta").textContent = `${label(e.agent)} · ${e.reason}`;
  el.querySelector(".q").textContent = e.question;
  for (const opt of e.options) {
    const b = document.createElement("button");
    b.textContent = opt;
    b.onclick = () => vscode.postMessage({ type: "answer", id: e.id, choice: opt });
    el.querySelector(".opts").appendChild(b);
  }
  $("decisions").prepend(el);
  decisions[e.id] = { ...e, el };
  updateCount();
}

function answerDecision(e) {
  const d = decisions[e.id];
  if (!d) return;
  d.el.classList.remove("pending");
  const opts = d.el.querySelector(".opts");
  opts.innerHTML = "";
  const s = document.createElement("span");
  s.innerHTML = `<span class="chose"></span> <span class="meta"></span>`;
  s.querySelector(".chose").textContent = `→ ${e.choice}`;
  s.querySelector(".meta").textContent = `· ${VIA[e.via] ?? e.via}`;
  opts.appendChild(s);
  d.done = true;
  updateCount();
}

function updateCount() {
  const n = Object.values(decisions).filter((d) => !d.done).length;
  $("pendingCount").textContent = n ? String(n) : "";
  document.title = n ? `Standup (${n})` : "Standup";
}

function setMode(mode) {
  for (const [id, m] of [["modeDesk", "desk"], ["modeAway", "away"]]) {
    $(id).classList.toggle("on", mode === m);
    $(id).setAttribute("aria-pressed", String(mode === m));
  }
}

function renderStatus(status) {
  const ul = $("status");
  ul.innerHTML = "";
  for (const [k, v] of Object.entries(status)) {
    const li = document.createElement("li");
    const ok = !/^(missing|off|not)/i.test(v);
    li.innerHTML = `<span></span><span class="${ok ? "ok" : "no"}"></span>`;
    li.children[0].textContent = k;
    li.children[1].textContent = v;
    ul.appendChild(li);
  }
}

function resetRun() {
  setEmpty("transcript");
  setEmpty("decisions");
  for (const k of Object.keys(decisions)) delete decisions[k];
  for (const k of Object.keys(files)) delete files[k];
  for (const k of Object.keys(statuses)) delete statuses[k];
  renderCards();
  updateCount();
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

vscode.postMessage({ type: "ready" });
