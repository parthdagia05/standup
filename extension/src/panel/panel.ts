import * as vscode from "vscode";
import { bus, BusEvent } from "../bus";
import { decisions } from "../decisions/router";
import { team } from "../voice/voices";

export interface PanelActions {
  start(feature: string): void;
  pushToTalk(): void;
  stop(): void;
  status(): Record<string, string>;
}

/** Mission Control: the team on a stage, the decision dock, and the live feed. */
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
  <header class="bar">
    <div class="brand">
      <span class="sigil" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="word">STANDUP</span>
      <span id="live" class="live" data-state="idle"><b></b><span id="liveText">STANDBY</span></span>
      <span id="clock" class="clock">00:00</span>
    </div>
    <div id="mission" class="mission" title=""></div>
    <div class="controls">
      <div class="seg" role="group" aria-label="Where decisions reach you">
        <button id="modeDesk" class="on" title="Decisions are spoken here">🎙 Desk</button>
        <button id="modeAway" title="Decisions come as a phone call">📞 Away</button>
      </div>
      <button id="stop" class="ghost" title="Stop all agents">■ Stop</button>
    </div>
  </header>

  <main class="deck">
    <section class="stage-wrap">
      <svg id="stage" class="stage" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet" aria-label="Team">
        <defs>
          <radialGradient id="coreGlow"><stop offset="0" stop-color="#f2b84b" stop-opacity=".55"/><stop offset="1" stop-color="#f2b84b" stop-opacity="0"/></radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>
        </defs>
        <g id="grid" class="grid"></g>
        <g id="links"></g>
        <g id="beams"></g>
        <g id="nodes"></g>
        <g id="bubbles"></g>
      </svg>
      <div id="summary" class="summary" hidden><span class="tag">MISSION COMPLETE</span><p id="summaryText"></p></div>
      <form id="startForm" class="launch">
        <button type="button" id="ptt" class="mic" title="Push to talk (⌘⇧Space)" aria-label="Push to talk"><span class="mic-ico"></span><span class="rings"></span></button>
        <input id="feature" placeholder="What should the team build?" autocomplete="off">
        <button type="submit" class="go">Launch ↵</button>
      </form>
    </section>

    <aside class="side">
      <section id="dock" class="dock" data-state="empty">
        <div class="dock-head"><span class="tag">DECISION DOCK</span><span id="pendingCount" class="count"></span></div>
        <div id="dockBody" class="dock-body"><p class="quiet">The team only interrupts you for real calls. Nothing pending.</p></div>
      </section>
      <section class="feed-wrap">
        <div class="dock-head"><span class="tag">LIVE FEED</span></div>
        <div id="feed" class="feed"><p class="quiet">Comms are quiet. Launch a mission to hear the team.</p></div>
      </section>
      <section class="systems">
        <div class="dock-head"><span class="tag">SYSTEMS</span><span id="history" class="hist"></span></div>
        <ul id="status" class="status"></ul>
      </section>
    </aside>
  </main>
</div>
<script nonce="${nonce}" src="${media("panel.js")}"></script>
</body>
</html>`;
  }
}
