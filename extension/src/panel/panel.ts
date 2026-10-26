import * as vscode from "vscode";
import { AGENTS, bus, BusEvent } from "../bus";
import { decisions } from "../decisions/router";
import { voiceFor } from "../voice/voices";

export interface PanelActions {
  start(feature: string): void;
  pushToTalk(): void;
  stop(): void;
  status(): Record<string, string>;
}

/** The webview: agent cards, live transcript, decision log, Desk/Away. */
export class StandupPanel {
  private static current: StandupPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, actions: PanelActions): void {
    if (StandupPanel.current) {
      StandupPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel("standup", "Standup", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    });
    StandupPanel.current = new StandupPanel(panel, context, actions);
  }

  private constructor(private panel: vscode.WebviewPanel, context: vscode.ExtensionContext, private actions: PanelActions) {
    panel.webview.html = this.html(context);
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");

    const unsub = bus.onAny((event) => this.post({ type: "event", event }));
    this.disposables.push({ dispose: unsub });

    panel.webview.onDidReceiveMessage(
      (msg) => {
        switch (msg.type) {
          case "ready":
            this.post({
              type: "init",
              agents: AGENTS.map((a) => ({ id: a, ...voiceFor(a) })),
              mode: decisions.mode,
              status: this.actions.status(),
              history: bus.history as BusEvent[],
            });
            break;
          case "start":
            this.actions.start(String(msg.text ?? ""));
            break;
          case "answer":
            decisions.answer(String(msg.id), String(msg.choice), "click");
            break;
          case "mode":
            decisions.setMode(msg.mode === "away" ? "away" : "desk");
            break;
          case "ptt":
            this.actions.pushToTalk();
            break;
          case "stop":
            this.actions.stop();
            break;
        }
      },
      null,
      this.disposables,
    );

    panel.onDidDispose(() => {
      StandupPanel.current = undefined;
      this.disposables.forEach((d) => d.dispose());
    });
  }

  private post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  private html(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", f));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media("panel.css")}">
<title>Standup</title>
</head>
<body>
<header>
  <div class="brand"><span class="logo">●</span> Standup <span id="runState" class="run-state">idle</span></div>
  <div class="controls">
    <div class="mode" role="group" aria-label="Where are you">
      <button id="modeDesk" class="seg on" title="Decisions are spoken here">🎙 Desk</button>
      <button id="modeAway" class="seg" title="Decisions come as a phone call">📞 Away</button>
    </div>
    <button id="ptt" class="ptt" title="Push to talk (⌘⇧Space)">🎙 Talk <kbd>⌘⇧Space</kbd></button>
    <button id="stop" class="ghost" title="Stop all agents">Stop</button>
  </div>
</header>

<form id="startForm" class="start">
  <input id="feature" placeholder="Say or type a feature, e.g. Add pagination and search to todos" autocomplete="off">
  <button type="submit">Start</button>
</form>

<section id="cards" class="cards"></section>

<main class="grid">
  <section class="col">
    <h2>Transcript</h2>
    <div id="transcript" class="transcript"><p class="empty">Nothing yet. Start a feature to hear the team.</p></div>
  </section>
  <section class="col">
    <h2>Decisions <span id="pendingCount" class="count"></span></h2>
    <div id="decisions" class="decisions"><p class="empty">The team will ask you here only when it matters.</p></div>
    <h2 class="sub">Status</h2>
    <ul id="status" class="status"></ul>
  </section>
</main>
<script nonce="${nonce}" src="${media("panel.js")}"></script>
</body>
</html>`;
  }
}
