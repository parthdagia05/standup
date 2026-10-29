// The scripted run the replica panel plays. Times are seconds on the video clock.
// Event shapes are the same ones the real extension's event bus emits.
const COLORS = { lead: "#b4761c", files: "#2f6fd0", dupes: "#24865c", roast: "#b8406f" };
const TEAM = [
  { id: "lead", label: "Lead", kind: "lead", owns: [], color: COLORS.lead },
  { id: "files", label: "Files", kind: "operator", owns: ["."], color: COLORS.files },
  { id: "dupes", label: "Dupes", kind: "operator", owns: ["."], color: COLORS.dupes },
  { id: "roast", label: "Roast", kind: "operator", owns: ["."], color: COLORS.roast },
];
const STATUS = {
  Model: "claude-opus-5-5",
  Voice: "macOS say",
  Mic: "sox ready",
  Phone: "calls +91 ••••• ••210",
  Server: "localhost:7777",
  Access: "laptop (any task)",
  Repo: "~/Desktop/kachra",
};
const FEATURE = "Organize kachra by file type, find the duplicates, and write me a roast";
const ev = (t, event) => ({ t, msg: { type: "event", event } });
const say = (t, agent, text) => ev(t, { type: "speak", agent, text });
const to = (t, from, target, text) => ev(t, { type: "agent.message", from, to: target, text });
const status = (t, agent, st, detail) => ev(t, { type: "agent.status", agent, status: st, detail });
const speaking = (t, agent) => ev(t, { type: "speaking", agent });
const file = (t, agent, path) => ev(t, { type: "file.changed", agent, path });

const EVENTS = [
  { t: 0, msg: { type: "init", agents: [TEAM[0]], mode: "desk", status: STATUS, history: [] } },
  ev(8.9, { type: "listening", on: true }),
  ev(13.5, { type: "listening", on: false }),
  ev(13.8, { type: "run.started", feature: FEATURE }),
  status(14.0, "lead", "thinking"),
  status(14.9, "lead", "working", "Glob kachra/*"),
  status(16.0, "lead", "working", "Read kachra"),
  ev(16.9, { type: "team.formed", members: TEAM }),
  speaking(17.2, "lead"),
  say(17.2, "lead", "Okay, a messy folder. Three of you should handle this."),
  to(18.8, "lead", "files", "Sort everything by file type."),
  to(19.2, "lead", "dupes", "Find the duplicates."),
  to(19.6, "lead", "roast", "Roast it. Kindly."),
  status(19.2, "lead", "done"),
  status(19.4, "files", "working", "$ ls kachra"),
  status(19.8, "dupes", "working", "$ shasum kachra/*"),
  status(20.0, "roast", "thinking"),
  speaking(20.6, "dupes"),
  to(20.7, "dupes", "files", "Hey Files, I'm hashing everything. I'll send you the dupes list."),
  speaking(22.0, "files"),
  to(22.1, "files", "dupes", "Nice. I'll move the rest by type meanwhile."),
  speaking(23.2, "roast"),
  to(23.3, "roast", "files", "How many screenshots are we talking? Asking for a roast."),
  speaking(24.2, "files"),
  to(24.3, "files", "roast", "Seven. All named Screenshot."),
  speaking(24.9, null),
  file(24.4, "files", "kachra/Images/Screenshot 1.png"),
  file(24.9, "files", "kachra/PDFs/invoice_final_FINAL2.pdf"),
  file(25.4, "files", "kachra/Videos/IMG_4421.mov"),
  ev(25.4, { type: "mode.changed", mode: "away" }),
  status(26.4, "dupes", "waiting", "needs your OK"),
  { t: 27.2, msg: { type: "event", event: { type: "decision.requested", id: "d1", agent: "dupes", question: "Dupes wants to delete 3 duplicate files. Allow it?", options: ["Yes, allow it", "No, don't"], reason: "destructive" } } },
  ev(27.5, { type: "phone.status", status: "calling +91 ••••• ••210", decisionId: "d1" }),
  ev(28.6, { type: "phone.status", status: "connected", decisionId: "d1" }),
  ev(30.9, { type: "decision.answered", id: "d1", choice: "Yes, allow it", via: "phone" }),
  ev(31.0, { type: "phone.status", status: "answer received", decisionId: "d1" }),
  status(31.0, "dupes", "working", "$ rm resume (1).pdf"),
  file(31.3, "roast", "kachra/roast.txt"),
  status(31.6, "dupes", "done"),
  status(31.6, "files", "done"),
  status(31.7, "roast", "done"),
  say(31.7, "lead", "All sorted. Three duplicates gone, and the roast is in the folder."),
  status(31.8, "lead", "done"),
  ev(31.9, { type: "run.finished", ok: true }),
];
