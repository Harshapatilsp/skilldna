import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { Snapshot } from '../../../packages/domain/protocol';
export class Dashboard {
  private panel?: vscode.WebviewPanel;
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onMessage: (message: unknown) => void,
  ) {}
  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const assets = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    this.panel = vscode.window.createWebviewPanel(
      'skilldna.dashboard',
      'SkillDNA',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [assets],
        retainContextWhenHidden: true,
      },
    );
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'assets', 'index.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'assets', 'index.css'));
    const nonce = randomBytes(16).toString('hex');
    webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src 'none';"><link rel="stylesheet" href="${style}"><title>SkillDNA</title></head><body><div id="root"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
    this.panel.webview.onDidReceiveMessage(this.onMessage, undefined, this.context.subscriptions);
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.context.subscriptions,
    );
    this.context.subscriptions.push(this.panel);
  }
  update(snapshot: Snapshot) {
    void this.panel?.webview.postMessage({ type: 'snapshot', snapshot });
  }
  error(message: string) {
    void this.panel?.webview.postMessage({ type: 'error', message });
  }
}
