import * as vscode from "vscode";
import { bus, BusEvent } from "../bus";
import { decisions } from "../decisions/router";
import { team } from "../voice/voices";

export interface PanelActions {
  start(feature: string): void;
  /** Typed text from the message box: a new feature when idle, a note to the team mid-run. */
  say(text: string): void;
  pushToTalk(): void;
  stop(): void;
  status(): Record<string, string>;
}

/** The standup call: who's on it, what they're saying, and what they need from you. */
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
              agents: team.info(),
              mode: decisions.mode,
              status: this.actions.status(),
              history: bus.history as BusEvent[],
            });
            break;
          case "start":
            this.actions.start(String(msg.text ?? ""));
            break;
          case "say":
            this.actions.say(String(msg.text ?? ""));
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
<div class="app">
  <header class="head">
    <div class="title-block">
      <h1 id="title">Standup</h1>
      <p id="meta" class="meta">No call in progress</p>
    </div>
    <div class="head-actions">
      <div class="seg" role="radiogroup" aria-label="Where questions reach you">
        <button id="modeDesk" role="radio" aria-checked="true">At my desk</button>
        <button id="modeAway" role="radio" aria-checked="false">Away, call me</button>
      </div>
      <button id="stop" class="btn-quiet" disabled>End standup</button>
    </div>
  </header>

  <div id="timeline" class="timeline" aria-label="Who spoke when" hidden></div>

  <div class="body">
    <aside class="roster" aria-label="On the call">
      <h2 class="section-label">On the call</h2>
      <ul id="people" class="people"></ul>
      <dl id="systems" class="systems"></dl>
    </aside>

    <main class="thread-col">
      <div id="pinned" class="pinned" hidden></div>
      <div id="thread" class="thread" aria-live="polite"></div>
      <form id="composer" class="composer">
        <button type="button" id="ptt" class="mic" title="Talk (⌘⇧Space)" aria-label="Talk to the team" aria-pressed="false">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg>
        </button>
        <input id="input" autocomplete="off" aria-label="Message">
        <button type="submit" id="send" class="btn-primary">Start standup</button>
      </form>
    </main>
  </div>
</div>
<script nonce="${nonce}" src="${media("panel.js")}"></script>
</body>
</html>`;
  }
}
