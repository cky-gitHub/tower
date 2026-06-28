import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { AgentManager } from './AgentManager'
import { WebviewToExt, ExtToWebview, ProviderName } from './types'

export class TowerPanel {
  static readonly viewType = 'tower.canvas'
  private static instance?: TowerPanel

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private messageUnsub?: () => void

  static createOrShow(extensionUri: vscode.Uri, manager: AgentManager) {
    const column = vscode.window.activeTextEditor?.viewColumn

    if (TowerPanel.instance) {
      TowerPanel.instance.panel.reveal(column)
      return TowerPanel.instance
    }

    const panel = vscode.window.createWebviewPanel(
      TowerPanel.viewType,
      'Tower',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-dist')],
        retainContextWhenHidden: true,
      }
    )

    TowerPanel.instance = new TowerPanel(panel, extensionUri, manager)
    return TowerPanel.instance
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly manager: AgentManager
  ) {
    this.panel = panel
    this.panel.iconPath = new vscode.ThemeIcon('radio-tower')
    this.panel.webview.html = this.buildHtml()

    const unsubFleet = manager.onFleetUpdate((sessions) => {
      this.send({ type: 'fleetUpdate', sessions })
    })
    this.disposables.push({ dispose: unsubFleet })

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExt) => this.handleMessage(msg),
      null,
      this.disposables
    )

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
  }

  private async handleMessage(msg: WebviewToExt) {
    const defaultProvider =
      (vscode.workspace
        .getConfiguration('tower')
        .get<string>('defaultProvider') as ProviderName) ?? 'claude'

    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong' })
        break

      case 'spawn':
        try {
          await this.manager.spawn(msg.prompt, msg.provider ?? defaultProvider)
        } catch (err) {
          this.send({ type: 'error', message: String(err) })
        }
        break

      case 'stop':
        try {
          await this.manager.stop(msg.sessionId)
        } catch (err) {
          this.send({ type: 'error', message: String(err) })
        }
        break

      case 'sendMessage':
        try {
          await this.manager.sendMessage(msg.sessionId, msg.text)
        } catch (err) {
          this.send({ type: 'error', message: String(err) })
        }
        break

      case 'subscribeMessages':
        this.messageUnsub?.()
        this.messageUnsub = this.manager.subscribeMessages(msg.sessionId, (messages) => {
          this.send({ type: 'messagesAppend', sessionId: msg.sessionId, messages })
        })
        break

      case 'unsubscribeMessages':
        this.manager.unsubscribeMessages(msg.sessionId)
        break

      case 'getInsights':
        try {
          const summary = await this.manager.getInsights(msg.sessionId)
          if (summary) this.send({ type: 'insightsUpdate', sessionId: msg.sessionId, summary })
        } catch {
          // insights unavailable
        }
        break

      case 'fork':
        try {
          await this.manager.fork(msg.sessionId, msg.instruction)
        } catch (err) {
          this.send({ type: 'error', message: String(err) })
        }
        break
    }
  }

  private send(msg: ExtToWebview) {
    this.panel.webview.postMessage(msg)
  }

  private buildHtml(): string {
    const webview = this.panel.webview
    const distDir = vscode.Uri.joinPath(this.extensionUri, 'webview-dist')
    const indexPath = path.join(distDir.fsPath, 'index.html')

    if (!fs.existsSync(indexPath)) {
      return this.fallbackHtml()
    }

    let html = fs.readFileSync(indexPath, 'utf8')

    // Rewrite ./assets/... paths to webview-safe URIs
    html = html.replace(/(src|href)="\.\/assets\/([^"]+)"/g, (_match, attr, file) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'assets', file))
      return `${attr}="${uri}"`
    })

    // VS Code-standard CSP: allow scripts and styles from localResourceRoots only
    const csp = [
      `default-src 'none'`,
      `script-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ')

    html = html.replace(
      '<head>',
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
    )

    return html
  }

  private fallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Tower</title></head>
<body style="background:#0a0e1a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
  <h2 style="margin:0">Tower — webview not built</h2>
  <p style="margin:0;color:#6b7280;font-size:14px">Run <code style="background:#1f2937;padding:2px 6px;border-radius:4px">cd extension && npm run build</code> then reload VS Code.</p>
</body>
</html>`
  }

  dispose() {
    TowerPanel.instance = undefined
    this.messageUnsub?.()
    this.disposables.forEach((d) => d.dispose())
    this.panel.dispose()
  }
}
