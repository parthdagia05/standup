// @ts-check
// The standup call view: roster, conversation thread, call timeline and the
// questions waiting on the developer, all driven by bus events.
const vscode = acquireVsCodeApi();
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const SUGGESTIONS = [
  "Add pagination and search to todos",
  "Let users mark a todo as done and delete todos",
  "Add a quote of the day shown at the top of the page",
];
const VIA = { voice: "answered by voice", phone: "answered on the phone", click: "clicked" };

/** @type {Map<string, {id:string,label:string,kind:string,color:string,owns:string[]}>} */
const agents = new Map();
/** @type {Map<string, {status:string, detail?:string, files:string[]}>} */
const people = new Map();
/** @type {Map<string, any>} */
const asks = new Map();
/** @type {{agent:string, t:number, peer:boolean}[]} */
let ticks = [];
/** @type {{id:string, t:number}[]} */
let marks = [];
let speaking = null;
let runStart = 0;
let runEnd = 0;
let live = false;
let clock = 0;
/** @type {{key:string, el:HTMLElement, lines:HTMLElement, at:number}|null} */
let lastGroup = null;
/** @type {{el:HTMLElement, done:Set<string>}|null} */
let assignBlock = null;

window.addEventListener("message", ({ data }) => {
  if (data.type === "init") {
    setTeam(data.agents);
    setMode(data.mode);
    renderSystems(data.status);
    showEmpty();
    for (const e of data.history) handle(e, true);
  } else if (data.type === "event") handle(data.event, false);
});

/** @param {any} e @param {boolean} replay */
function handle(e, replay) {
  switch (e.type) {
    case "run.started":
      startRun(e.feature);
      break;
    case "team.formed":
      setTeam(e.members);
      if (e.members.length > 1) teamNote(e.members);
      break;
    case "speak":
      say(e.agent, e.text);
      tick(e.agent, false);
      break;
    case "user.said":
      // When idle, what you say starts the run, and the run opens with it.
      if (live) say("you", e.text);
      break;
    case "agent.message":
      message(e);
      break;
    case "decision.requested":
      ask(e);
      break;
    case "decision.answered":
      answered(e);
      break;
    case "agent.status":
      setStatus(e.agent, e.status, e.detail);
      break;
    case "file.changed":
      fileChanged(e.agent, e.path);
      break;
    case "speaking":
      speaking = e.agent;
      document.querySelectorAll(".person").forEach((p) => p.classList.toggle("speaking", p.getAttribute("data-id") === e.agent));
      break;
    case "listening":
      $("ptt").setAttribute("aria-pressed", String(e.on));
      refreshComposer(e.on);
      break;
    case "mode.changed":
      setMode(e.mode);
      break;
    case "phone.status":
      phone(e);
      break;
    case "run.finished":
      endRun(e);
      break;
    case "log":
      if (e.level !== "info") note(e.text, "bad");
      break;
  }
  if (!replay) renderTimeline();
}

// ---------- roster ----------

function setTeam(members) {
  for (const m of members) {
    agents.set(m.id, m);
    if (!people.has(m.id)) people.set(m.id, { status: "idle", files: [] });
  }
  for (const id of [...agents.keys()]) if (!members.some((m) => m.id === id)) agents.delete(id);
  renderRoster();
}

function renderRoster() {
  const ul = $("people");
  ul.innerHTML = "";
  for (const a of agents.values()) {
    const p = people.get(a.id) ?? { status: "idle", files: [] };
    const li = document.createElement("li");
    li.className = "person";
    li.dataset.id = a.id;
    li.style.setProperty("--c", a.color);
    if (p.status === "waiting") li.classList.add("waiting");
    if (a.id === speaking) li.classList.add("speaking");

    const name = document.createElement("div");
    name.className = "p-name";
    const n = document.createElement("span");
    n.textContent = a.label;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = a.id === "lead" ? "runs the call" : describeOwns(a);
    const bars = document.createElement("span");
    bars.className = "bars";
    bars.setAttribute("aria-label", "speaking");
    bars.innerHTML = "<i></i><i></i><i></i>";
    name.append(n, kind, bars);

    const state = document.createElement("div");
    state.className = "p-state";
    if (p.status === "done") state.classList.add("done");
    if (p.status === "error") state.classList.add("error");
    state.textContent = stateText(a.id, p);
    state.title = state.textContent;

    li.append(avatar(a.id), name, state);
    if (p.files.length) {
      const files = document.createElement("ul");
      files.className = "p-files";
      for (const f of p.files.slice(-3)) {
        const fl = document.createElement("li");
        fl.textContent = f;
        fl.title = f;
        files.appendChild(fl);
      }
      if (p.files.length > 3) {
        const more = document.createElement("li");
        more.textContent = `and ${p.files.length - 3} more`;
        files.appendChild(more);
      }
      li.appendChild(files);
    }
    ul.appendChild(li);
  }
}

function describeOwns(a) {
  const owns = a.owns.filter((o) => o !== ".").map((o) => `${o}/`);
  return owns.length ? owns.join(" ") : a.kind;
}

function stateText(id, p) {
  const d = p.detail ? humanDetail(p.detail) : "";
  switch (p.status) {
    case "thinking": return id === "lead" && !runStart ? "Ready" : d || "Thinking";
    case "working": return d || "Working";
    case "waiting": return d.startsWith("same question") ? "Waiting on the same answer" : "Waiting for you";
    case "done": return p.files.length ? `Done, changed ${p.files.length} file${p.files.length > 1 ? "s" : ""}` : "Done";
    case "error": return "Ran into a problem";
    default: return d ? capitalize(d) : runStart ? "Waiting to start" : "Ready";
  }
}

/** "Edit server.js" → "Editing server.js", "$ npm test" → "Running npm test". */
function humanDetail(d) {
  if (d.startsWith("$ ")) return `Running ${d.slice(2)}`;
  const m = d.match(/^(Read|Edit|Write|Grep|Glob|MultiEdit)\s*(.*)$/);
  if (m) {
    const verb = { Read: "Reading", Edit: "Editing", MultiEdit: "Editing", Write: "Writing", Grep: "Searching", Glob: "Looking through" }[m[1]];
    return `${verb} ${m[2] || "the code"}`.trim();
  }
  return d;
}

function setStatus(id, status, detail) {
  const p = people.get(id) ?? { status: "idle", files: [] };
  p.status = status;
  p.detail = detail;
  people.set(id, p);
  renderRoster();
}

function fileChanged(id, path) {
  const p = people.get(id) ?? { status: "working", files: [] };
  if (!p.files.includes(path)) p.files.push(path);
  people.set(id, p);
  renderRoster();
}

function avatar(id) {
  const el = document.createElement("span");
  el.className = "avatar";
  if (id === "you") {
    el.classList.add("you");
    el.textContent = "You";
    return el;
  }
  const a = agents.get(id);
  el.style.setProperty("--c", a?.color ?? "#777");
  el.textContent = initials(a?.label ?? id);
  el.setAttribute("aria-hidden", "true");
  return el;
}

function initials(label) {
  return label.trim().charAt(0).toUpperCase();
}

// ---------- thread ----------

function thread() {
  const t = $("thread");
  t.querySelector(".empty")?.remove();
  return t;
}

function scrollDown() {
  const t = $("thread");
  t.scrollTop = t.scrollHeight;
}

/** Consecutive lines from the same person (to the same audience) share one header. */
function group(from, to) {
  const key = `${from}>${to ?? "you"}`;
  const now = elapsed();
  if (lastGroup && lastGroup.key === key && now - lastGroup.at < 90) {
    lastGroup.at = now;
    return lastGroup.lines;
  }
  const g = document.createElement("div");
  g.className = "group";
  const head = document.createElement("div");
  head.className = "g-head";
  const name = document.createElement("span");
  name.className = "g-name";
  name.textContent = from === "you" ? "You" : label(from);
  head.appendChild(name);
  if (to && to !== "you") {
    const toEl = document.createElement("span");
    toEl.className = "g-to";
    toEl.append("to ");
    const b = document.createElement("b");
    b.textContent = to === "team" ? "the team" : label(to);
    toEl.appendChild(b);
    head.appendChild(toEl);
  }
  const time = document.createElement("span");
  time.className = "g-time";
  time.textContent = stamp(now);
  head.appendChild(time);
  const lines = document.createElement("div");
  lines.className = "g-lines";
  g.append(avatar(from), head, lines);
  thread().appendChild(g);
  lastGroup = { key, el: g, lines, at: now };
  return lines;
}

function say(from, text, to) {
  const p = document.createElement("p");
  p.className = "line" + (to && to !== "you" ? " peer" : "");
  p.textContent = text;
  group(from, to).appendChild(p);
  scrollDown();
}

function message(e) {
  if (e.to === "team" && e.text.startsWith("Contract:")) {
    const d = document.createElement("details");
    d.className = "contract";
    const s = document.createElement("summary");
    s.textContent = "Published the interface everyone builds against";
    const pre = document.createElement("pre");
    pre.textContent = e.text.replace(/^Contract:\s*/, "");
    d.append(s, pre);
    group(e.from, "team").appendChild(d);
    lastGroup = null;
    scrollDown();
    return;
  }
  // The Lead's task hand-offs right after hiring read as one list.
  if (e.from === "lead" && assignBlock && agents.has(e.to) && !assignBlock.done.has(e.to)) {
    assignBlock.done.add(e.to);
    const li = document.createElement("li");
    li.style.setProperty("--c", agents.get(e.to)?.color ?? "inherit");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = label(e.to);
    const task = document.createElement("span");
    task.textContent = e.text;
    li.append(who, task);
    assignBlock.el.appendChild(li);
    if (assignBlock.done.size >= agents.size - 1) assignBlock = null;
    scrollDown();
    return;
  }
  say(e.from, e.text, e.to);
  tick(e.from, true);
}

function teamNote(members) {
  const workers = members.filter((m) => m.id !== "lead");
  const lines = group("lead", "you");
  const p = document.createElement("p");
  p.className = "line";
  p.textContent = `I've brought in ${listNames(workers.map((w) => w.label))}. Here's who's doing what:`;
  const ul = document.createElement("ul");
  ul.className = "assign";
  lines.append(p, ul);
  assignBlock = { el: ul, done: new Set() };
  lastGroup = null;
  scrollDown();
}

function note(text, kind = "") {
  const p = document.createElement("p");
  p.className = "note" + (kind ? ` ${kind}` : "");
  p.textContent = text;
  thread().appendChild(p);
  lastGroup = null;
  scrollDown();
}

// ---------- questions ----------

function ask(e) {
  const card = document.createElement("section");
  card.className = "ask";
  card.setAttribute("aria-label", `Question from ${label(e.agent)}`);
  const head = document.createElement("div");
  head.className = "ask-head";
  const who = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = label(e.agent);
  who.append(b, ` needs a decision${e.reason && e.reason !== "other" ? ` · ${reasonText(e.reason)}` : ""}`);
  head.append(avatar(e.agent), who);
  const q = document.createElement("p");
  q.className = "ask-q";
  q.textContent = e.question;
  const opts = document.createElement("div");
  opts.className = "ask-opts";
  e.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = i === 0 ? "btn-primary" : "btn-secondary";
    const k = document.createElement("kbd");
    k.textContent = String(i + 1);
    btn.append(k, opt);
    btn.onclick = () => vscode.postMessage({ type: "answer", id: e.id, choice: opt });
    opts.appendChild(btn);
  });
  const foot = document.createElement("div");
  foot.className = "ask-foot";
  foot.textContent = "Answer out loud with ⌘⇧Space, type it below, or press a number.";
  card.append(head, q, opts, foot);
  $("pinned").appendChild(card);
  $("pinned").hidden = false;
  asks.set(e.id, { ...e, card, foot, at: elapsed() });
  marks.push({ id: e.id, t: elapsed() });
  refreshComposer(false);
}

function answered(e) {
  const a = asks.get(e.id);
  if (!a) return;
  a.done = true;
  a.card.remove();
  $("pinned").hidden = !$("pinned").children.length;

  const rec = document.createElement("section");
  rec.className = "ask answered";
  const head = document.createElement("div");
  head.className = "ask-head";
  const who = document.createElement("span");
  const b = document.createElement("b");
  b.textContent = label(a.agent);
  who.append(b, " asked");
  head.append(avatar(a.agent), who);
  const q = document.createElement("p");
  q.className = "ask-q";
  q.textContent = a.question;
  const ans = document.createElement("div");
  const choice = document.createElement("span");
  choice.className = "choice";
  choice.textContent = e.choice.replace(/ \(the developer answered.*$/, "");
  const via = document.createElement("span");
  via.className = "via";
  via.textContent = ` · ${VIA[e.via] ?? e.via}`;
  ans.append("You chose ", choice, via);
  rec.append(head, q, ans);
  thread().appendChild(rec);
  lastGroup = null;
  scrollDown();
  refreshComposer(false);
}

function phone(e) {
  const a = e.decisionId ? asks.get(e.decisionId) : null;
  if (a && !a.done) {
    const calling = /calling|ringing/.test(e.status);
    a.foot.className = "ask-foot" + (calling ? " calling" : "");
    a.foot.innerHTML = calling ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 2.2 3.4 2c-.8 0-1.4.7-1.3 1.5.6 5.4 4.9 9.7 10.3 10.3.8.1 1.5-.5 1.5-1.3l-.2-1.8-2.6-1.1-1.3 1.3c-1.7-.8-3-2.1-3.8-3.8l1.3-1.3z"/></svg><span></span>' : "<span></span>";
    a.foot.lastElementChild.textContent =
      e.status === "calling" ? "Calling your phone…" : e.status === "ringing" ? "Your phone is ringing. Pick up to answer." : capitalize(e.status);
  }
  if (/can't call|failed|without an answer|couldn't/.test(e.status)) note(`Phone: ${e.status}`, "bad");
}

function reasonText(r) {
  return { contract: "how two parts talk to each other", package: "a new package", test: "existing tests", schema: "the data model", destructive: "something destructive", access: "outside the project" }[r] ?? r;
}

// ---------- run lifecycle ----------

function startRun(feature) {
  runStart = Date.now();
  runEnd = 0;
  live = true;
  ticks = [];
  marks = [];
  asks.clear();
  people.clear();
  lastGroup = null;
  assignBlock = null;
  $("thread").innerHTML = "";
  $("pinned").innerHTML = "";
  $("pinned").hidden = true;
  $("title").textContent = feature;
  $("stop").removeAttribute("disabled");
  $("timeline").hidden = false;
  clearInterval(clock);
  clock = setInterval(() => {
    renderMeta();
    renderTimeline();
  }, 1000);
  renderMeta();
  refreshComposer(false);
  say("you", feature);
}

function endRun(e) {
  live = false;
  runEnd = Date.now();
  clearInterval(clock);
  renderMeta(e.ok ? "Finished" : "Ended early");
  renderTimeline();
  $("stop").setAttribute("disabled", "");
  refreshComposer(false);

  const wrap = document.createElement("section");
  wrap.className = "wrap";
  const h = document.createElement("h3");
  h.textContent = e.ok ? "Wrap-up" : "Stopped";
  wrap.appendChild(h);
  if (e.summary) {
    const p = document.createElement("p");
    p.textContent = e.summary;
    wrap.appendChild(p);
  }
  const ul = document.createElement("ul");
  for (const a of agents.values()) {
    const p = people.get(a.id);
    if (!p?.files.length) continue;
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = a.label;
    li.append(b, ` changed ${p.files.join(", ")}`);
    ul.appendChild(li);
  }
  const decided = [...asks.values()].filter((x) => x.done).length;
  if (decided) {
    const li = document.createElement("li");
    li.textContent = `You made ${decided} decision${decided > 1 ? "s" : ""}.`;
    ul.appendChild(li);
  }
  if (ul.children.length) wrap.appendChild(ul);
  thread().appendChild(wrap);
  lastGroup = null;
  scrollDown();
}

function renderMeta(endedLabel) {
  const meta = $("meta");
  meta.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "live-dot" + (live ? "" : " ended");
  const count = agents.size;
  meta.append(dot, `${endedLabel ?? (live ? "Live" : "Ended")} · ${stamp(elapsed())} · ${count} ${count === 1 ? "person" : "people"} on the call`);
}

function renderTimeline() {
  const tl = $("timeline");
  if (!runStart) return;
  const total = Math.max(elapsed(), 10);
  tl.innerHTML = "";
  for (const a of agents.values()) {
    const name = document.createElement("div");
    name.className = "tl-name";
    name.textContent = a.label;
    const track = document.createElement("div");
    track.className = "tl-track";
    track.style.setProperty("--c", a.color);
    for (const t of ticks) {
      if (t.agent !== a.id) continue;
      const tickEl = document.createElement("span");
      tickEl.className = "tl-tick" + (t.peer ? " peer" : "");
      tickEl.style.left = `${(t.t / total) * 100}%`;
      track.appendChild(tickEl);
    }
    for (const m of marks) {
      const ask = asks.get(m.id);
      if (!ask || ask.agent !== a.id) continue;
      const mk = document.createElement("span");
      mk.className = "tl-mark" + (ask.done ? " done" : "");
      mk.style.left = `${(m.t / total) * 100}%`;
      mk.title = ask.question;
      track.appendChild(mk);
    }
    tl.append(name, track);
  }
}

function tick(agent, peer) {
  if (runStart) ticks.push({ agent, t: elapsed(), peer });
}

function elapsed() {
  if (!runStart) return 0;
  return Math.max(0, ((runEnd || Date.now()) - runStart) / 1000);
}

function stamp(s) {
  const n = Math.floor(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

// ---------- chrome ----------

function showEmpty() {
  const t = $("thread");
  if (t.children.length) return;
  const box = document.createElement("div");
  box.className = "empty";
  const h = document.createElement("h2");
  h.textContent = "Start a standup";
  const p = document.createElement("p");
  p.textContent = "Describe a feature. The Lead looks over the repo, asks you one question, and brings in the people it needs. They'll check with you only when a real decision comes up.";
  const list = document.createElement("div");
  list.className = "suggestions";
  for (const s of SUGGESTIONS) {
    const b = document.createElement("button");
    b.textContent = s;
    b.onclick = () => vscode.postMessage({ type: "say", text: s });
    list.appendChild(b);
  }
  box.append(h, p, list);
  t.appendChild(box);
}

function refreshComposer(listening) {
  const input = /** @type {HTMLInputElement} */ ($("input"));
  const pending = [...asks.values()].some((a) => !a.done);
  input.placeholder = listening
    ? "Listening… press ⌘⇧Space again when you're done"
    : pending
      ? "Type your answer, or press a number"
      : live
        ? "Tell the team something"
        : "Describe a feature to build";
  $("send").textContent = live ? "Send" : "Start standup";
}

function setMode(mode) {
  $("modeDesk").setAttribute("aria-checked", String(mode === "desk"));
  $("modeAway").setAttribute("aria-checked", String(mode === "away"));
}

function renderSystems(s) {
  const dl = $("systems");
  dl.innerHTML = "";
  const names = { Agents: "Signed in", Model: "Model", Voice: "Voices", Mic: "Microphone", Phone: "Phone", Server: "Callback", Repo: "Repo" };
  for (const [k, v] of Object.entries(s)) {
    if (k === "Repo") continue;
    const dt = document.createElement("dt");
    dt.textContent = names[k] ?? k;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    dd.title = String(v);
    if (/^(missing|off|not)/i.test(String(v))) dd.className = "off";
    dl.append(dt, dd);
  }
}

function label(id) {
  return agents.get(id)?.label ?? (id === "lead" ? "Lead" : id);
}
function listNames(names) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

$("composer").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($("input"));
  const text = input.value.trim();
  if (!text) return;
  vscode.postMessage({ type: "say", text });
  input.value = "";
});
$("modeDesk").onclick = () => vscode.postMessage({ type: "mode", mode: "desk" });
$("modeAway").onclick = () => vscode.postMessage({ type: "mode", mode: "away" });
$("ptt").onclick = () => vscode.postMessage({ type: "ptt" });
$("stop").onclick = () => vscode.postMessage({ type: "stop" });

// 1-4 answers the oldest open question, unless you're typing.
document.addEventListener("keydown", (ev) => {
  if (document.activeElement?.tagName === "INPUT" || ev.metaKey || ev.ctrlKey) return;
  const n = Number(ev.key);
  if (!n || n > 4) return;
  const open = [...asks.values()].find((a) => !a.done);
  if (open?.options[n - 1]) vscode.postMessage({ type: "answer", id: open.id, choice: open.options[n - 1] });
});

refreshComposer(false);
vscode.postMessage({ type: "ready" });
