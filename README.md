# Standup

**Agents run the build. You make the calls.**

Standup is a VS Code extension where a team of AI agents builds a feature in your repo, talks to each other out loud, and only stops to ask you real decisions. At your desk you answer by voice. When you walk away, your codebase phones you through [Bolna](https://bolna.ai).

Built for the Bolna buildathon (deadline Oct 31, 2026).

## What it does

- A **Lead** agent reads your repo, asks you at most one product question, then **hires a team of 1 to 6** agents that fits the task. Each teammate owns specific folders or files.
- Agents **talk to each other out loud** ("Hey Web, quick one about the API shape...") using different voices, and work in parallel.
- When agents disagree or hit a real fork, one question reaches **you**. **Desk mode:** spoken aloud, answer with push-to-talk, or click. **Away mode:** a Bolna phone call, and you answer by talking.
- Risky actions (package installs that look suspicious, `rm -rf`, `git push`, `sudo`, reaching outside the project) are intercepted **in code**, not left to the model.
- Two access modes: `project` (agents stay inside the repo, inside their own folders) and `laptop` (any task on the machine; credential folders blocked; risky actions ask, by phone when you are away).

## Demo

- Website and setup guide: https://parthdagia05.github.io/standup/
- Demo video (about 3 minutes, narrated, captioned): [docs/assets/standup-demo.mp4](docs/assets/standup-demo.mp4), also embedded on the website.

The demo section of the video is an illustrative replay of the real panel, not a live recording. Its source is in [demo-video/](demo-video/).

## How it works

```
                          VS Code extension host (Node)
 ┌────────────────────────────────────────────────────────────────────────┐
 │  Lead agent ── form_team ──▶ teammates (1-6), each owns some paths      │
 │       Claude Agent SDK, one query() per agent                          │
 │        │ speak / say_to / request_decision / discuss / ask_teammate    │
 │        ▼  (custom tools)                                               │
 │   Event bus ──▶ Panel (webview: cards, transcript, decision log)       │
 │        │                                                               │
 │        ├──▶ Voice out: macOS `say`, or Cartesia -> sox `play`          │
 │        │                                                               │
 │   permissions.ts (canUseTool): folder ownership, package check on npm, │
 │        │          destructive/privileged commands -> a decision        │
 │        ▼                                                               │
 │   Decision router                                                      │
 │     Desk : speak question; answer by voice (sox `rec` -> Deepgram),    │
 │            click, or type                                              │
 │     Away : Bolna POST /call ──────────────▶ your phone                 │
 │                                                                        │
 │   Express server :7777  ◀── ngrok ◀── Bolna custom function            │
 │     POST /decision {decision_id, choice}        submit_decision        │
 └────────────────────────────────────────────────────────────────────────┘
```

If Bolna's function never fires, the extension polls `GET /executions/{id}` after the call and reads the answer from `extracted_data` or the call transcript. Spoken or phoned answers are mapped to your options with simple rules first, then a small model (`standup.parseModel`).

## Setup

### Prerequisites

- macOS (voice uses `say`, `sox`; paths in the safety rules are macOS paths)
- Node.js 20 or newer (`package.json` has no `engines` field; 20 is the roadmap's assumption)
- VS Code 1.95 or newer
- `sox`: `brew install sox` (provides `rec` and `play`)
- `ngrok`, logged in (needed for Away mode only)
- Agent auth: either a Claude Code login on this machine, or an `ANTHROPIC_API_KEY`
- A [Deepgram](https://deepgram.com) API key (push-to-talk; without it you type your answers)
- Optional: a [Cartesia](https://cartesia.ai) API key (without it, agents use macOS voices)
- A [Bolna](https://bolna.ai) account (Away mode only)

### Install and build

```bash
git clone https://github.com/parthdagia05/standup.git
cd standup/extension
npm install
npm run build
```

`npm run typecheck` runs `tsc --noEmit` if you want to check the code.

### Fill in `extension/.env`

```bash
cp .env.example .env     # .env is git-ignored
```

Everything is optional; missing keys fall back to something that still works. Variables, exactly as in `.env.example`:

| Variable | Where to get it | If missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Agents use this machine's Claude Code login |
| `CARTESIA_API_KEY` | Cartesia dashboard | macOS `say` voices |
| `CARTESIA_VOICE_LEAD` | A voice id from Cartesia's voice library | No Cartesia voice for the Lead |
| `CARTESIA_VOICE_FRONTEND` | Voice id | See note below |
| `CARTESIA_VOICE_BACKEND` | Voice id | See note below |
| `CARTESIA_VOICE_TESTS` | Voice id | See note below |
| `# CARTESIA_MODEL=sonic-2` | Optional override (commented out by default) | `sonic-2` |
| `# CARTESIA_VERSION=2025-04-16` | Optional override | `2025-04-16` |
| `DEEPGRAM_API_KEY` | Deepgram console | No push-to-talk; a text box opens instead |
| `# DEEPGRAM_LANGUAGE=en` | Optional override | `en` |
| `BOLNA_API_KEY` | Bolna dashboard, developers/API keys | Away mode asks in the panel instead |
| `BOLNA_AGENT_ID` | The id of the Bolna agent you create below | Same |
| `# BOLNA_FROM_NUMBER=` | Optional, the number Bolna calls from | Bolna's default |
| `STANDUP_PHONE=+91XXXXXXXXXX` | Your number with country code | Same (can also be set in VS Code settings) |

Note on voices: the code looks up `CARTESIA_VOICE_<KIND>` where `<KIND>` is the teammate's kind (for example `BACKEND`). Since the Lead picks the team per task, you can also set `CARTESIA_VOICES` (comma-separated voice ids, handed out in hiring order) as a pool. That variable is read by the code but is not listed in `.env.example`.

Real environment variables win over the file.

### Run it

1. Open this repo in VS Code and press **F5**, choosing the launch configuration **Run Standup on demo-app**. It builds the extension, then opens an Extension Development Host on the `demo-app` folder.
2. In the new window, open the Command Palette and run **Standup: Open Panel**. The status bar shows `Standup: Desk`.
3. Run **Standup: Start a Feature** (or type or speak a request) and watch the team work.

`demo-app/` is a small todo app that is part of this repo, so a fresh clone can run the demo. You can point the launch config, or the `standup.repoPath` setting, at any other repo.

### Commands and push-to-talk

| Command | What it does |
|---|---|
| `Standup: Open Panel` | Opens the team panel |
| `Standup: Start a Feature` | Prompts for what to build |
| `Standup: Push to Talk` | Starts, then stops, recording |
| `Standup: Toggle Desk / Away` | Switches where decisions reach you (also the status bar item) |
| `Standup: Stop All Agents` | Stops the run and cancels waiting decisions |

Push-to-talk keybinding: **Cmd+Shift+Space** (Ctrl+Shift+Space on Windows and Linux). Press once to record, press again to stop; the clip is sent to Deepgram (`nova-3`). What you say goes to the oldest waiting decision first; otherwise it starts a new run, or is passed to the Lead as a note if a run is active.

The first time, macOS will ask to let VS Code use the microphone.

### Set up the Bolna agent (Away mode)

1. **Create an agent** in the Bolna dashboard. Language: **English**.
2. **Agent prompt.** The extension sends four variables with every call: `agent_name`, `question`, `options`, `decision_id`. Use them in double braces, for example:

   ```text
   You are {{agent_name}}, an AI developer on the user's team. Ask exactly this
   question: {{question}}. The options are: {{options}}. When the user picks
   one, call submit_decision with decision_id {{decision_id}} and the option
   they chose. Then confirm briefly and end the call.
   ```

   Ending the call is done by the prompt (hangup by prompt); there is no separate end-call logic in the extension.
3. **Custom function** named `submit_decision`, method **POST**, URL `https://<your-ngrok-domain>/decision`. Parameters: `decision_id` (string) and `choice` (string). Parameter names must match exactly in the properties and the parameter mapping; matching is case-sensitive. The server accepts the values as JSON, form data or query string, and also accepts `answer` for `choice` and `decisionId` for `decision_id`.
4. **Expose the local server.** The extension listens on port 7777 (setting `standup.serverPort`):

   ```bash
   ngrok http 7777 --url=<your-ngrok-domain>
   ```

   Check it: `curl https://<your-ngrok-domain>/health` returns `{"ok":true,...}`.
5. Copy the agent id into `BOLNA_AGENT_ID` and your API key into `BOLNA_API_KEY` in `extension/.env`.
6. **Trial plan limits:** on Bolna's trial plan you can only call **verified numbers**. Verify your own phone number in the dashboard first.

Optional: in Bolna's analytics tab, set up extraction of a field named `choice` (or `decision`). If the custom function does not fire, the extension reads that field from the finished call, and otherwise falls back to the call transcript.

### Configure access mode and phone number

In VS Code settings (`Cmd+,`, search "Standup"), or `settings.json`:

```json
{
  "standup.access": "project",
  "standup.phoneNumber": "+919876543210"
}
```

- `standup.access`: `project` (default) or `laptop`.
- `standup.phoneNumber` overrides `STANDUP_PHONE` from `.env`. Use international format.
- Other settings: `standup.repoPath` (empty means the first workspace folder), `standup.model` and `standup.leadModel` (default `claude-sonnet-5-5`; the setting's description suggests `claude-opus-5-5` for the real demo), `standup.parseModel` (default `claude-haiku-5-5`), `standup.voice` (`auto`, `cartesia`, `say`, `off`), `standup.serverPort` (default 7777).

Reload the window after changing settings that affect startup, such as the server port.

## First try-it

**At the desk**

1. Start the Extension Development Host (F5) on `demo-app`, run **Standup: Open Panel**.
2. Run **Standup: Start a Feature**. The default text is "Add pagination and search to todos".
3. The Lead may ask one product question out loud. Press Cmd+Shift+Space, answer, press it again.
4. Watch the team form in the panel and listen to them coordinate. When a decision comes up, answer by voice ("the second one"), click, or type.

**Away mode**

1. Make sure `BOLNA_API_KEY`, `BOLNA_AGENT_ID` and a phone number are set, ngrok is running, and the Bolna function points at it.
2. Click **Away** in the panel (or run **Standup: Toggle Desk / Away**). The status bar changes to `Standup: Away`.
3. Start a feature, step away. When a decision appears, your phone rings; say your answer. The panel logs the answer as coming by phone and the agent continues.

To reset `demo-app` between runs: `demo-app/scripts/reset.sh` (it runs `git checkout`, `git clean` and `npm install` inside `demo-app`, so it discards uncommitted changes there).

## Safety model

Enforced in `extension/src/agents/permissions.ts` through the SDK's `canUseTool`, not by prompting.

| | Project mode | Laptop mode (additionally) |
|---|---|---|
| **Auto-approved** | Reads and writes inside your repo (writes only in the agent's owned paths and `.standup/`); ordinary commands inside the repo; `npm`/`pnpm`/`yarn`/`bun` installs that pass the package check (below) | Reads anywhere except credentials; writes outside system locations |
| **Always asks** (a decision, phoned in Away mode) | `pip install`; `rm -rf`; database migrations (prisma, knex, sequelize, drizzle-kit); `git push`; `sudo`; `curl`/`wget` piped to a shell; global npm installs; reads or commands touching paths outside the project; risky or unverifiable npm packages | Shutdown or reboot; `killall`/`pkill`; disk erase or format; changing system settings (`defaults`, `launchctl`, `networksetup`, `pmset`, ...); sending mail or messages; keychain commands; writes to `/System`, `/Library`, `/etc`, `~/Library`, shell rc files |
| **Blocked** | Writing outside your own paths (the agent is told who owns the file and to use `say_to`); the Lead editing files or running commands | `~/.ssh`, `~/.aws`, `~/.gnupg`, `Library/Keychains`, `~/.config/gcloud`, `~/.kube`, `~/.netrc`: never readable or writable |

Package check: an install is auto-approved only if the package exists on npm, is not deprecated, runs no `preinstall`/`install`/`postinstall`/`prepare` script, and has at least 100,000 downloads in the last week. If npm cannot be reached or anything is unclear, it asks. A bare `npm install` (no package names) is not checked.

These are pattern-based checks on commands, so they reduce risk but are not a sandbox. Run laptop mode on a machine and account you are comfortable experimenting with.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel or status says "missing sox" / mic not working | `brew install sox`, then fully restart VS Code. The extension adds `/opt/homebrew/bin` and `/usr/local/bin` to the PATH it uses for sox, so a Dock-launched VS Code is fine. Check `which rec`. |
| Push-to-talk opens a text box instead of recording | `DEEPGRAM_API_KEY` is not set. Add it to `extension/.env` and restart the Extension Development Host. |
| Recording gives nothing | Allow VS Code to use the microphone in System Settings, Privacy and Security, Microphone, then restart VS Code. Hold the recording for at least a moment; clips under about 0.3 s are discarded. |
| No voice from agents | Check `standup.voice` is not `off`. Without `CARTESIA_API_KEY` it uses macOS `say`; check your system volume. With Cartesia, make sure a voice id is set for that teammate, or it falls back to `say`. |
| Phone call doesn't arrive | Run the **Standup** output channel (View, Output) and look at the `📞` lines. Common causes: missing `BOLNA_API_KEY`, `BOLNA_AGENT_ID` or phone number (the panel says "can't call: ..."); number not verified on the Bolna trial plan; you are still in Desk mode. |
| Call happens but the agent never continues | The custom function did not reach the server. Confirm ngrok is running, the function URL ends in `/decision`, and `curl https://<domain>/health` works. The extension will also poll the finished call and read `extracted_data` or the transcript; if it still cannot tell your answer, it asks you to answer in the panel. |
| Port 7777 in use | Change `standup.serverPort` and restart ngrok with the new port. |
| Agents fail to start, auth errors | Either run `claude` once and log in, or set `ANTHROPIC_API_KEY` in `extension/.env`. The Output channel prints which one is used. |
| "Standup is already running" | Run **Standup: Stop All Agents**. |

## Limitations

- **macOS only** in practice (`say`, Homebrew paths, macOS sensitive locations).
- Away mode calls **one decision at a time**, one call per decision, with a 6 minute wait. The roadmap's idea of batching several decisions into one call is not implemented.
- Speech-to-text sends one clip per utterance (Deepgram pre-recorded endpoint), so there is a short pause after you stop talking. No interruption or barge-in.
- Away-mode setup needs ngrok and a Bolna agent configured by hand; the extension does not create them.
- Safety checks are regex and path based. Obfuscated commands or paths built at runtime can slip past them.
- The Lead asks at most one question per run, and a run allows only a few cross-team requests (`MAX_TEAMMATE_REQUESTS = 3`).
- Not published to the Marketplace; run it from source (F5).

## Project layout

```
voiceCoding/
├── README.md
├── ROADMAP.md                    # build plan and original design notes
├── .vscode/                      # F5 launch config: "Run Standup on demo-app"
├── demo-app/                     # todo app agents work on
├── demo-video/                   # renderer for the demo video
├── docs/                         # website and setup guide (GitHub Pages)
│   ├── backend/  frontend/  tests/
│   └── scripts/reset.sh
└── extension/
    ├── package.json              # commands, keybinding, settings
    ├── .env.example
    ├── esbuild.mjs
    ├── media/                    # panel.js, panel.css, icon
    └── src/
        ├── extension.ts          # activate(): wires everything, status bar, commands
        ├── config.ts             # settings and .env loading
        ├── bus.ts                # typed event bus
        ├── server.ts             # Express :7777, POST /decision, GET /health
        ├── agents/
        │   ├── orchestrator.ts   # Lead hires the team, runs the agents
        │   ├── tools.ts          # speak, say_to, ask_user, form_team, request_decision, ...
        │   ├── permissions.ts    # access rules (canUseTool)
        │   ├── packageSafety.ts  # npm registry check for installs
        │   ├── prompts.ts        # Lead and teammate prompts
        │   └── sdk.ts            # Claude Agent SDK loading and auth
        ├── decisions/
        │   ├── router.ts         # Desk vs Away
        │   ├── phone.ts          # Bolna call and polling fallback
        │   └── parse.ts          # "the second one" -> an option
        ├── voice/
        │   ├── stt.ts            # sox rec -> Deepgram
        │   ├── tts.ts            # say or Cartesia -> sox play, speech queue
        │   └── voices.ts         # team roster and voices
        └── panel/panel.ts        # webview host
```

## Credits

Built on the [Claude Agent SDK](https://docs.claude.com), [Deepgram](https://deepgram.com) (speech-to-text), [Cartesia](https://cartesia.ai) (text-to-speech), [Bolna](https://bolna.ai) (voice phone calls) and [ngrok](https://ngrok.com). Made for the Bolna buildathon, 2026. Licensed MIT (per `package.json`).
