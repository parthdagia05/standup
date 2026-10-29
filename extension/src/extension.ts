import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import * as vscode from "vscode";
import { Orchestrator } from "./agents/orchestrator";
import { authMode } from "./agents/sdk";
import { bus } from "./bus";
import { childEnv, config, loadEnv, secret } from "./config";
import { phone, phoneConfigured } from "./decisions/phone";
import { decisions } from "./decisions/router";
import { StandupPanel } from "./panel/panel";
import { startServer } from "./server";
import { Recorder } from "./voice/stt";
import { speech } from "./voice/tts";
import { agentLabel } from "./voice/voices";

let server: Server | undefined;

export function activate(context: vscode.ExtensionContext): void {
  loadEnv(context.extensionPath);
  const out = vscode.window.createOutputChannel("Standup");
  const orchestrator = new Orchestrator();
  const recorder = new Recorder();

  bus.onAny((e) => {
    if (e.type === "log") out.appendLine(`[${e.level}] ${e.text}`);
    else if (e.type === "speak") out.appendLine(`🗣 ${agentLabel(e.agent)}: ${e.text}`);
    else if (e.type === "decision.requested") out.appendLine(`❓ ${agentLabel(e.agent)}: ${e.question} [${e.options.join(" | ")}]`);
    else if (e.type === "decision.answered") out.appendLine(`✅ ${e.id} → ${e.choice} (${e.via})`);
    else if (e.type === "phone.status") out.appendLine(`📞 ${e.status}`);
  });

  // Click fallback even when the panel is hidden.
  bus.on("decision.requested", async (e) => {
    if (decisions.mode !== "desk") return;
    const pick = await vscode.window.showInformationMessage(`${agentLabel(e.agent)}: ${e.question}`, ...e.options.slice(0, 3));
    if (pick) decisions.answer(e.id, pick, "click");
  });

  phone.onAnswer = (id, lines) => void decisions.answerFromCall(id, lines);
  server = startServer(config.serverPort());

  const status = (): Record<string, string> => ({
    Agents: authMode(),
    Model: config.model(),
    Voice: voiceStatus(),
    Mic: micStatus(),
    Phone: phoneConfigured().ok ? `calls ${config.phoneNumber()}` : `not set up (${phoneConfigured().why})`,
    Server: `localhost:${config.serverPort()}`,
    Access: config.laptop() ? "laptop (any task)" : "project only",
    Repo: config.repoPath() ?? "missing: open demo-app",
  });

  const actions = {
    start: (feature: string) => {
      if (!feature.trim()) return;
      if (orchestrator.active) {
        void vscode.window.showWarningMessage("Standup is already running. Stop it first.");
        return;
      }
      StandupPanel.show(context, actions);
      orchestrator.run(feature.trim()).catch((err) => vscode.window.showErrorMessage(`Standup: ${err.message}`));
    },
    say: (text: string) => void handleUtterance(text),
    pushToTalk: () => void pushToTalk(),
    stop: () => {
      orchestrator.stop();
      if (recorder.recording) void recorder.stop().catch(() => {});
      speech.unmute();
    },
    status,
  };

  /** What you said goes to a waiting decision first, otherwise it's a new feature or a note. */
  async function handleUtterance(text: string): Promise<void> {
    text = text.trim();
    if (!text) return;
    bus.emit({ type: "user.said", text });
    const pending = decisions.oldestPending();
    if (pending) {
      await decisions.answerFromSpeech(pending.id, text, "voice");
    } else if (!orchestrator.active) {
      actions.start(text);
    } else {
      orchestrator.addNote(text);
      speech.say("lead", "Got it, I'll pass that on to the team.", true);
    }
  }

  async function pushToTalk(): Promise<void> {
    if (recorder.recording) {
      bus.emit({ type: "listening", on: false });
      try {
        const text = await recorder.stop();
        if (text) await handleUtterance(text);
        else void vscode.window.setStatusBarMessage("Standup: didn't hear anything", 3000);
      } catch (err) {
        void vscode.window.showErrorMessage(`Standup mic: ${(err as Error).message}`);
      } finally {
        speech.unmute();
      }
      return;
    }
    const mic = Recorder.available();
    if (!mic.ok) {
      // No speech-to-text yet: type what you would have said.
      const pending = decisions.oldestPending();
      const text = await vscode.window.showInputBox({
        title: pending ? `${agentLabel(pending.agent)} asks: ${pending.question}` : "Standup",
        prompt: `Voice input is off (${mic.why}). Type what you'd say.`,
        placeHolder: pending ? pending.options.join("  /  ") : "Add pagination and search to todos",
      });
      if (text) await handleUtterance(text);
      return;
    }
    speech.mute();
    recorder.start();
    bus.emit({ type: "listening", on: true });
  }

  const modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const renderMode = () => {
    modeItem.text = decisions.mode === "desk" ? "$(mic) Standup: Desk" : "$(call-outgoing) Standup: Away";
    modeItem.tooltip = "Toggle where decisions reach you";
  };
  modeItem.command = "standup.toggleAway";
  renderMode();
  modeItem.show();
  bus.on("mode.changed", renderMode);

  context.subscriptions.push(
    out,
    modeItem,
    vscode.commands.registerCommand("standup.openPanel", () => StandupPanel.show(context, actions)),
    vscode.commands.registerCommand("standup.start", async () => {
      const feature = await vscode.window.showInputBox({ prompt: "What should the team build?", value: "Add pagination and search to todos" });
      if (feature) actions.start(feature);
    }),
    vscode.commands.registerCommand("standup.pushToTalk", () => actions.pushToTalk()),
    vscode.commands.registerCommand("standup.toggleAway", () => decisions.setMode(decisions.mode === "desk" ? "away" : "desk")),
    vscode.commands.registerCommand("standup.stop", () => actions.stop()),
    { dispose: () => orchestrator.stop() },
  );

  out.appendLine(`Standup ready. Agents use: ${authMode()}. ${JSON.stringify(status())}`);
}

function voiceStatus(): string {
  const mode = config.voice();
  if (mode === "off") return "off";
  if ((mode === "auto" || mode === "cartesia") && secret("CARTESIA_API_KEY")) return "Cartesia";
  return "macOS say (no Cartesia key)";
}

function micStatus(): string {
  if (!secret("DEEPGRAM_API_KEY")) return "off: type instead (no Deepgram key)";
  try {
    execFileSync("which", ["rec"], { env: childEnv() });
    return "Deepgram + sox";
  } catch {
    return "missing sox (brew install sox)";
  }
}

export function deactivate(): void {
  speech.stopAll();
  server?.close();
}
