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
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

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

    // Fleet updates → webview
    const unsubFleet = manager.onFleetUpdate((sessions) => {
      this.send({ type: 'fleetUpdate', sessions })
    })
    this.disposables.push({ dispose: unsubFleet })

    // Webview → extension host
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExt) => this.handleMessage(msg),
      null,
      this.disposables
    )

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
  }

  private async handleMessage(msg: WebviewToExt) {
    const defaultProvider =
      (vscode.workspace.getConfiguration('tower').get<string>('defaultProvider') as ProviderName) ??
      'claude'

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
          if (summary) {
            this.send({ type: 'insightsUpdate', sessionId: msg.sessionId, summary })
          }
        } catch {
          // insights not available
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

    // Read the built index.html and resolve asset URIs for the webview sandbox
    const indexPath = path.join(distDir.fsPath, 'index.html')
    if (!fs.existsSync(indexPath)) {
      return this.fallbackHtml()
    }

    let html = fs.readFileSync(indexPath, 'utf8')

    // Replace ./assets/... paths with webview-safe URIs
    html = html.replace(/(src|href)="\.\/assets\/([^"]+)"/g, (_match, attr, file) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'assets', file))
      return `${attr}="${uri}"`
    })

    // Add CSP
    const nonce = getNonce()
    html = html.replace(
      '<head>',
      `<head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">`
    )
    html = html.replace(/<script /g, `<script nonce="${nonce}" `)

    return html
  }

  private fallbackHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Tower</title></head>
<body style="background:#0a0e1a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <h2>Tower webview not built</h2>
    <p>Run <code>npm run build</code> in the <code>webview/</code> directory, then reload VS Code.</p>
  </div>
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

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
