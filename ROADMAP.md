# Standup — Roadmap

> **Agents run the build. You make the calls.**
> A VS Code extension where your codebase's folders are voice agents. They build features in parallel, talk to each other out loud, and stop to ask you, by voice in the editor or by phone call, only when a real decision is needed.

**Deadline:** Oct 31, 2026 (Bolna Buildathon). **Today:** Oct 21. That's 10 working days plus a buffer.

---

## 0. How to use this doc

- Work through the phases **in order**. Every phase has a **Done when** check. Don't start the next phase until that check passes.
- Every phase also has an **If stuck** fallback. If you've been blocked for more than 2 hours, take the fallback and move on. A working demo beats a perfect design.
- **Cut line:** Phases 1–4 are the minimum product you can submit. Phases 5–7 add the wow factor. Phase 8 is the submission and isn't optional.

---

## 1. Architecture (read this once, carefully)

```
┌──────────────────────── VS Code ────────────────────────┐
│  Extension host (Node/TypeScript)                        │
│                                                          │
│  ┌───────────┐   tasks   ┌──────────────────────────┐    │
│  │ Lead agent│──────────▶│ Folder agents (one each) │    │
│  │ (kickoff) │           │ frontend / backend / tests│   │
│  └─────┬─────┘           └──────┬───────────────────┘    │
│        │  speak() / request_decision()  (custom tools)   │
│        ▼                        ▼                        │
│  ┌──────────────────── Event Bus ───────────────────┐    │
│  │ events: speak, decision.requested, decision.     │    │
│  │ answered, agent.status, file.changed             │    │
│  └───┬──────────────┬──────────────┬────────────────┘    │
│      ▼              ▼              ▼                     │
│  Voice I/O      Webview panel   Decision Router          │
│  (sox mic →     (who's talking, ├─ at desk → speak + listen
│  Deepgram STT;  transcript,     └─ away → Bolna phone call
│  Cartesia TTS   decision log)                            │
│  → sox play)                                             │
│                                                          │
│  Local HTTP server :7777 ◀── ngrok ◀── Bolna custom function
└──────────────────────────────────────────────────────────┘
```

### Key design decisions (already made, don't revisit them)

| Decision | Choice | Why |
|---|---|---|
| Agent runtime | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), one `query()` per agent | It already includes Read, Write, Edit, Bash and Grep, so you don't build file tools yourself |
| Model | `claude-opus-5-5` | Strongest coding model. Use `effort: "low"` on folder agents if they're too slow |
| How agents speak | A custom **`speak(text)`** tool on each agent | You always know *who* is talking, so you can pick the right voice, and agents stay short |
| How agents ask you | A custom **`request_decision(question, options[])`** tool that **blocks** until you answer | This is the core feature |
| Enforcing checkpoints | A **`PreToolUse` hook** on `Bash` that catches `npm install`, `pip install`, `rm -rf`, migrations and `git push`, and turns them into decisions | Checkpoints are enforced *by code*, not by hoping the model asks |
| Folder isolation | A `PreToolUse` hook on `Write`/`Edit` that denies writes outside the agent's folder | The frontend agent can't edit backend files |
| Microphone | Native **`sox`** (`rec`) as a child process. **Not** the webview mic | Mic access in VS Code webviews is unreliable. This avoids a whole day of debugging |
| Talking style | **Push-to-talk** (keybinding held or toggled) | No voice-activity detection or echo cancellation needed. Interruption is a stretch goal |
| STT | Deepgram streaming (`nova-3`) over WebSocket | Fast, and a sponsor |
| TTS | Cartesia (`sonic`), with a different `voice_id` for each agent | Fast, distinct voices, and a sponsor |
| Phone | **Bolna** outbound call (`POST https://api.bolna.ai/call`). The Bolna agent calls our **custom function** with the answer | Sponsor, and the demo hook |
| Agent ↔ agent | A shared `.standup/contracts.md` file plus a `message_agent(to, text)` tool routed by the orchestrator | Simple and easy to inspect, and it shows up in the UI |

### Repository layout

```
voiceCoding/
├── extension/                 # the VS Code extension
│   ├── package.json           # contributes commands, keybindings, view
│   ├── src/
│   │   ├── extension.ts       # activate(): wires everything
│   │   ├── bus.ts             # typed EventEmitter
│   │   ├── agents/
│   │   │   ├── orchestrator.ts# spins up lead + folder agents
│   │   │   ├── tools.ts       # speak, request_decision, message_agent (createSdkMcpServer)
│   │   │   ├── hooks.ts       # PreToolUse: checkpoints + folder isolation
│   │   │   └── prompts.ts     # system prompts per agent
│   │   ├── voice/
│   │   │   ├── mic.ts         # sox rec → PCM stream
│   │   │   ├── stt.ts         # Deepgram websocket
│   │   │   ├── tts.ts         # Cartesia → PCM → sox play; speech queue
│   │   │   └── voices.ts      # agent → voice_id map
│   │   ├── decisions/
│   │   │   ├── router.ts      # desk vs away
│   │   │   ├── parse.ts       # "the first one" → option index
│   │   │   └── phone.ts       # Bolna call + waiting for answer
│   │   ├── server.ts          # :7777 — /decision endpoint for Bolna
│   │   └── panel/             # webview UI (plain HTML/JS is fine)
│   └── tsconfig.json
├── demo-app/                  # the repo we demo on
│   ├── frontend/  backend/  tests/
└── ROADMAP.md
```

### Event types (agree on these on day 1)

```ts
type BusEvent =
  | { type: "speak"; agent: AgentName; text: string }
  | { type: "decision.requested"; id: string; agent: AgentName; question: string; options: string[]; reason: "package" | "schema" | "contract" | "test" | "destructive" | "other" }
  | { type: "decision.answered"; id: string; choice: string; via: "voice" | "phone" | "click" }
  | { type: "agent.status"; agent: AgentName; status: "idle" | "thinking" | "working" | "waiting" | "done" }
  | { type: "agent.message"; from: AgentName; to: AgentName; text: string }
  | { type: "file.changed"; agent: AgentName; path: string };
type AgentName = "lead" | "frontend" | "backend" | "tests";
```

---

## 2. Phase 0 — Accounts and setup (Oct 21, today, about 2h)

Do this first. Account approvals and phone-number verification are the most likely thing to block you without warning.

- [ ] **Anthropic API key** (console.anthropic.com), with credits loaded
- [ ] **Deepgram** account and API key (free credits)
- [ ] **Cartesia** account and API key. Pick **4 voices** that sound clearly different (lead, frontend, backend, tests)
- [ ] **Bolna** account: create an agent and **make one test call to your own phone today**. Check what Indian numbers and KYC it needs. ⚠️ This is the most likely blocker, so start it first.
- [ ] **ngrok** (or `cloudflared`) installed and logged in, so you have a public URL to your laptop
- [ ] `brew install sox`, then check that `rec test.wav` records and `play test.wav` plays it back
- [ ] Node 20+, `npm i -g yo generator-code`
- [ ] Put all keys in `extension/.env` (git-ignored)

**Done when:** You've received a Bolna call on your phone, and `sox` can record and play back.
**If stuck on Bolna:** Keep going. Phone calls are Phase 5, and you can borrow a teammate's account or number by then.

---

## 3. Phase 1 — Agents work in text (Oct 22–23)

Goal: no voice yet. Prove the multi-agent core works on the demo repo.

**Tasks**
1. Scaffold the extension (`yo code` → TypeScript). Add the command `standup.start`.
2. Build `demo-app/`: a tiny todo app with an **Express backend** (`/todos` GET/POST), a **plain React or Vite frontend** that lists the todos, and **tests** (vitest/jest) with 2 passing tests. Keep it small so agents can read it quickly.
3. `bus.ts`: a typed EventEmitter using the events above.
4. `tools.ts`: an in-process MCP server built with `createSdkMcpServer` + `tool()`:
   - `speak({ text })` emits a `speak` event and returns `"ok"`. Log it to the Output channel for now.
   - `request_decision({ question, options })` emits `decision.requested` and **returns a Promise** that resolves on the matching `decision.answered`. For now, answer with a VS Code `showQuickPick`.
5. `orchestrator.ts`:
   - The **lead agent** gets the feature request and **does not write code**. It breaks the work into 1–3 tasks, one per folder, and calls `assign_task(agent, task)`.
   - Each **folder agent** is its own `query()` with `cwd` set to the repo root and a prompt like: *"You own `backend/`. Narrate with `speak` in at most 1 sentence. Ask with `request_decision` before any choice a senior dev would want a say in."*
   - Run the folder agents **concurrently** (`Promise.all`).
6. `hooks.ts`: `PreToolUse`
   - On `Bash`: if the command matches `/(npm|pnpm|yarn) (i|install|add)|pip install|rm -rf|prisma migrate|git push/`, turn it into a `request_decision` ("Backend wants to run `npm install zod`. Allow?") → allow or deny.
   - On `Write`/`Edit`: deny if the path is outside the agent's folder.

**Done when:** Typing "add a `priority` field to todos" makes the backend and frontend agents edit their own folders in parallel, a QuickPick appears for at least one decision, and the tests agent runs the tests.

**If stuck**
- Subagents or parallel `query()` misbehave → run the folder agents **one after another**. Nobody watching the demo can tell.
- The hook API is confusing → use `canUseTool` with `permissionMode: "default"` and *no* `allowedTools` for Bash, so every Bash call goes through your callback.
- Agents are too slow → lower `effort` on the folder agents, and keep the demo repo tiny.

---

## 4. Phase 2 — Agents speak (Oct 24)

**Tasks**
1. `tts.ts`: a Cartesia streaming TTS client that outputs raw PCM and pipes it to `play -t raw -r 24000 -e signed -b 16 -c 1 -`.
2. **Speech queue**: only one voice plays at a time, in FIFO order. `decision.requested` jumps to the front of the queue.
3. `voices.ts`: map each agent to a Cartesia `voice_id`.
4. Have each voice say its name the first time it speaks ("Backend here.").

**Done when:** You run Phase 1 again and *hear* three different voices narrating without talking over each other.
**If stuck:** If streaming is a hassle, request the whole clip, write a `.wav` file to a temp folder, and play it with `afplay`. That adds about 300ms but works.

---

## 5. Phase 3 — You speak back (Oct 25)

**Tasks**
1. `mic.ts`: spawn `rec -q -t raw -r 16000 -e signed -b 16 -c 1 -` and stream stdout to Deepgram's live WebSocket (`encoding=linear16&sample_rate=16000&model=nova-3&smart_format=true`).
2. **Push-to-talk**: the keybinding `cmd+shift+space` toggles recording. Stop TTS playback while you're talking.
3. Route each final transcript:
   - If a decision is pending → `parse.ts` turns "the first one", "go with Zod" or "yes" into an option. Do it with a quick `claude-haiku-5-5` call: *"Options: [...]. User said: '...'. Return the option string or NONE."* If it returns NONE, re-ask.
   - Otherwise → send it as a new instruction to the lead agent.
4. **Kickoff conversation**: the lead agent asks 1–2 clarifying questions out loud *before* it assigns tasks (and "doesn't plan everything").

**Done when:** You run the whole flow hands-free. You say the feature, the lead asks a question, you answer, the agents build, a decision comes up, you say "the second one", and the work continues.
**If stuck**
- `sox` can't access the mic → give VS Code microphone access in macOS System Settings → Privacy, then restart VS Code.
- The Deepgram WebSocket is flaky → record until you release the key, then send the clip to Deepgram's pre-recorded endpoint.

---

## 6. Phase 4 — Panel UI (Oct 26)

Judges will be watching your screen while they listen, so the screen needs to show what's happening.

**Tasks** (webview, plain HTML + CSS + JS, no framework)
1. **Agent cards**: name, voice color, status dot (thinking/working/waiting/done), and the files it touched. The card of whoever is speaking glows.
2. **Live transcript**: a chat-style log of every `speak`, `agent.message` and your speech.
3. **Decision log**: each question, its options, your choice, and how you answered (🎙 voice / 📞 phone / 🖱 click). Pending decisions show clickable buttons as a fallback.
4. **Desk / Away toggle**: switches the Decision Router to phone mode.

**Done when:** You could follow a whole run with the sound off, using only the panel.
**If stuck:** The panel can be ugly. Clarity beats polish. You can make it look nice later in Phase 8 if there's time.

> ✅ **Cut line.** After Phase 4 you have a complete, submittable product. Everything after this point is a bonus.

---

## 7. Phase 5 — Your codebase calls you (Oct 27–28)

This is the most memorable part of the demo. Give it two days, because phone integrations always surprise you.

**Bolna setup (dashboard)**
- Agent prompt (uses `user_data` variables): *"You are {agent_name}, an AI developer on the user's team. Ask exactly this question: {question}. Options: {options}. Once the user picks one, call `submit_decision` with the option text, confirm briefly, and end the call."*
- **Custom function** `submit_decision` (key `custom_task`), method POST → `https://<ngrok>/decision`, params `decision_id` (passed in through `user_data`) and `choice`. Make sure parameter names match exactly in `properties` and `param`, because matching is case-sensitive.
- Pick a TTS voice for the call, and turn on Hinglish if Bolna or Sarvam supports it (the jury is Indian, so this will land well).

**Code**
1. `server.ts`: an Express server on `:7777` with `POST /decision {decision_id, choice}` → emits `decision.answered` with `via: "phone"`.
2. `phone.ts`: when the mode is Away, `POST https://api.bolna.ai/call` with `Authorization: Bearer <key>` and
   ```json
   { "agent_id": "...", "recipient_phone_number": "+91XXXXXXXXXX",
     "user_data": { "agent_name": "Backend", "question": "...", "options": "cursor | offset", "decision_id": "d_42" } }
   ```
3. **Backup path for receiving the answer**: if the custom function isn't called, poll `GET /executions/{execution_id}` until the status is `completed`, then read the answer from `extracted_data` or the transcript (set up extraction in the Bolna analytics tab).
4. **Batching**: if 2+ decisions are pending, handle them in *one* call instead of phoning repeatedly.

**Done when:** With Away mode on, you leave the laptop, your phone rings, you answer, the agent in VS Code continues, and the panel shows 📞.
**If stuck**
- The custom function never fires → use the polling backup above.
- An Indian number isn't available in time → call an international or test number, or record a successful call as backup footage.
- If nothing works by **Oct 28 at 6pm**, drop the phone feature from the live demo and show a pre-recorded clip of it working. Don't let this phase eat Phase 8.

---

## 8. Phase 6 — Agents argue out loud (Oct 29, morning)

**Tasks**
1. `message_agent(to, text)` tool: the orchestrator delivers it as the next user message in the target agent's `query()` stream (use streaming input mode, where `prompt` is an `AsyncIterable`).
2. Contract flow: before coding an endpoint, the backend writes a proposal to `.standup/contracts.md` and messages the frontend. The frontend accepts or counter-proposes. **If they disagree twice → `request_decision` to you.**
3. Both sides speak during the negotiation, so the audience hears it.

**Done when:** In the demo feature, you hear Frontend and Backend disagree about pagination, and the decision comes to you.
**If stuck:** Script the disagreement in the demo repo, for example by having the frontend's existing code expect `page`/`limit` while the backend prompt prefers cursors. That reliably produces the moment you want.

---

## 9. Phase 7 — Polish and stretch goals (Oct 29 afternoon)

Pick at most two:
- [ ] **Barge-in**: start talking (push-to-talk) to interrupt any agent mid-sentence
- [ ] **End-of-run summary**: the lead reads out everything that was decided and changed
- [ ] **"What are you doing?"**: ask any agent and it answers from its recent activity
- [ ] **Hinglish mode** with Sarvam STT/TTS
- [ ] Filler lines ("checking with backend…") while an agent is thinking, so there's no dead air

---

## 10. Phase 8 — Demo and submission (Oct 30–31)

### Demo script (target 2:30)
1. **(0:00) Hook.** "AI coding agents either make every decision without you, or make you babysit them. Standup gives every folder a voice and only asks you about real decisions."
2. **(0:15) Kickoff.** Say *"Add pagination and search to todos."* The lead asks *"Should search be server-side?"* You: *"Yes."*
3. **(0:40) Parallel build.** Three voices narrate, and the panel cards light up.
4. **(1:00) Checkpoint.** Backend: *"I want to install zod for validation. Okay?"* You: *"Yes."*
5. **(1:15) Argument.** Frontend vs Backend on cursor vs offset → it comes to you.
6. **(1:30) Away.** Switch to Away, walk off, **your phone rings**, Tests: *"Two tests are failing because the old API shape changed. Update the tests or keep backward compatibility?"*. You answer on the phone.
7. **(2:10) Result.** The lead reads the summary, the tests are green, and the app works.
8. **(2:20) Close.** "Developers stop reviewing diffs and start making decisions. It scales to any team, from anywhere."

### Checklist
- [ ] Record the demo video **on Oct 30**. Record several takes and keep the best one.
- [ ] README: problem, GIF, architecture diagram, setup steps, which sponsors you used (Bolna, Deepgram, Cartesia, Exotel/Plivo through Bolna, Sarvam if used)
- [ ] Public GitHub repo with no keys committed
- [ ] Prepare interview answers: *Who pays? Why voice and not chat? How is this different from Copilot or Claude Code voice? What would it look like with 10 agents?*
- [ ] **Submit by Oct 31 at noon.** Don't wait until midnight.

---

## 11. Calendar at a glance

| Date | Phase | Must-have output |
|---|---|---|
| Tue Oct 21 | 0 · Setup | Bolna test call works, sox works |
| Wed Oct 22 | 1 · Text agents | Extension, demo-app, bus, tools |
| Thu Oct 23 | 1 · Text agents | Parallel agents, hooks, QuickPick decisions |
| Fri Oct 24 | 2 · Speak | 3 distinct voices, speech queue |
| Sat Oct 25 | 3 · Listen | Push-to-talk, decision parsing, voice kickoff |
| Sun Oct 26 | 4 · Panel | Agent cards, transcript, decision log ✅ **cut line** |
| Mon Oct 27 | 5 · Phone | Bolna agent and custom function, server, ngrok |
| Tue Oct 28 | 5 · Phone | End-to-end call, polling backup (go/no-go at 6pm) |
| Wed Oct 29 | 6 + 7 | Agent argument, two polish items |
| Thu Oct 30 | 8 | Stable demo, recorded video, README |
| Fri Oct 31 | 8 | **Submit by noon** |

### If you have a team
- **Person A:** agents, orchestrator and hooks (Phases 1, 6)
- **Person B:** voice I/O and the panel (Phases 2, 3, 4)
- **Person C:** Bolna phone flow, server, demo-app and the video (Phases 0, 5, 8)
- Agree on the `BusEvent` types on day 1. That's the only interface everyone shares.

---

## 12. Top risks

| Risk | Mitigation |
|---|---|
| Bolna or Indian number setup is slow | Start on Day 0, use the polling backup, keep a recorded clip of a working call |
| Agents are slow, causing dead air | Tiny demo repo, low `effort` on folder agents, filler lines, a speech queue |
| Too many decision prompts | The hook only gates the regex list. The prompt says to ask at most 3 times per feature |
| The live demo breaks | Fixed demo feature, `git reset` script between takes, recorded backup video |
| Sound echoes into the mic | Push-to-talk, and TTS is muted while recording. Use headphones on stage |
