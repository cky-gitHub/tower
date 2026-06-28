"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TowerPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class TowerPanel {
    static createOrShow(extensionUri, manager) {
        if (TowerPanel.instance) {
            TowerPanel.instance.panel.reveal(vscode.ViewColumn.Two, true);
            return TowerPanel.instance;
        }
        const panel = vscode.window.createWebviewPanel(TowerPanel.viewType, 'Tower', { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-dist')],
            retainContextWhenHidden: true,
        });
        TowerPanel.instance = new TowerPanel(panel, extensionUri, manager);
        return TowerPanel.instance;
    }
    constructor(panel, extensionUri, manager) {
        this.extensionUri = extensionUri;
        this.manager = manager;
        this.disposables = [];
        this.panel = panel;
        this.panel.iconPath = new vscode.ThemeIcon('radio-tower');
        this.panel.webview.html = this.buildHtml();
        const unsubFleet = manager.onFleetUpdate((sessions) => {
            this.send({ type: 'fleetUpdate', sessions });
        });
        this.disposables.push({ dispose: unsubFleet });
        this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    async handleMessage(msg) {
        const defaultProvider = vscode.workspace
            .getConfiguration('tower')
            .get('defaultProvider') ?? 'claude';
        switch (msg.type) {
            case 'ping':
                this.send({ type: 'pong' });
                break;
            case 'spawn':
                try {
                    await this.manager.spawn(msg.prompt, msg.provider ?? defaultProvider);
                }
                catch (err) {
                    this.send({ type: 'error', message: String(err) });
                }
                break;
            case 'stop':
                try {
                    await this.manager.stop(msg.sessionId);
                }
                catch (err) {
                    this.send({ type: 'error', message: String(err) });
                }
                break;
            case 'sendMessage':
                try {
                    await this.manager.sendMessage(msg.sessionId, msg.text);
                }
                catch (err) {
                    this.send({ type: 'error', message: String(err) });
                }
                break;
            case 'subscribeMessages':
                this.messageUnsub?.();
                this.messageUnsub = this.manager.subscribeMessages(msg.sessionId, (messages) => {
                    this.send({ type: 'messagesAppend', sessionId: msg.sessionId, messages });
                });
                break;
            case 'unsubscribeMessages':
                this.manager.unsubscribeMessages(msg.sessionId);
                break;
            case 'getInsights':
                try {
                    const summary = await this.manager.getInsights(msg.sessionId);
                    if (summary)
                        this.send({ type: 'insightsUpdate', sessionId: msg.sessionId, summary });
                }
                catch {
                    // insights unavailable
                }
                break;
            case 'fork':
                try {
                    await this.manager.fork(msg.sessionId, msg.instruction);
                }
                catch (err) {
                    this.send({ type: 'error', message: String(err) });
                }
                break;
        }
    }
    send(msg) {
        this.panel.webview.postMessage(msg);
    }
    buildHtml() {
        const webview = this.panel.webview;
        const distDir = vscode.Uri.joinPath(this.extensionUri, 'webview-dist');
        const indexPath = path.join(distDir.fsPath, 'index.html');
        if (!fs.existsSync(indexPath)) {
            return this.fallbackHtml();
        }
        let html = fs.readFileSync(indexPath, 'utf8');
        // Rewrite ./assets/... paths to webview-safe URIs
        html = html.replace(/(src|href)="\.\/assets\/([^"]+)"/g, (_match, attr, file) => {
            const uri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'assets', file));
            return `${attr}="${uri}"`;
        });
        // VS Code-standard CSP: allow scripts and styles from localResourceRoots only
        const csp = [
            `default-src 'none'`,
            `script-src ${webview.cspSource}`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `img-src ${webview.cspSource} data:`,
            `font-src ${webview.cspSource}`,
        ].join('; ');
        html = html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
        return html;
    }
    fallbackHtml() {
        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Tower</title></head>
<body style="background:#0a0e1a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
  <h2 style="margin:0">Tower — webview not built</h2>
  <p style="margin:0;color:#6b7280;font-size:14px">Run <code style="background:#1f2937;padding:2px 6px;border-radius:4px">cd extension && npm run build</code> then reload VS Code.</p>
</body>
</html>`;
    }
    dispose() {
        TowerPanel.instance = undefined;
        this.messageUnsub?.();
        this.disposables.forEach((d) => d.dispose());
        this.panel.dispose();
    }
}
exports.TowerPanel = TowerPanel;
TowerPanel.viewType = 'tower.canvas';
//# sourceMappingURL=TowerPanel.js.map