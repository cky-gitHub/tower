import * as vscode from 'vscode'
import { AgentManager } from './AgentManager'
import { TowerPanel } from './TowerPanel'
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider'
import { DevinProvider } from './providers/DevinProvider'

let manager: AgentManager | undefined

export function activate(context: vscode.ExtensionContext) {
  manager = new AgentManager()

  // Claude Code provider — always registered
  const cfg = vscode.workspace.getConfiguration('tower')
  const claudePath = cfg.get<string>('claude.path')?.trim() || 'claude'
  manager.register(new ClaudeCodeProvider(claudePath))

  // Devin provider — only if org ID is configured
  const orgId = cfg.get<string>('devin.orgId')?.trim() ?? ''
  if (orgId) {
    manager.register(
      new DevinProvider(
        () => Promise.resolve(context.secrets.get('tower.devin.apiKey')).then((k) => k ?? ''),
        () => vscode.workspace.getConfiguration('tower').get<string>('devin.orgId') ?? ''
      )
    )
  }

  manager.startFleetPoll()

  context.subscriptions.push(
    vscode.commands.registerCommand('tower.open', () => {
      TowerPanel.createOrShow(context.extensionUri, manager!)
    }),

    vscode.commands.registerCommand('tower.setDevinApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Devin API key (cog_...)',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.startsWith('cog_') ? null : 'Key should start with cog_'),
      })
      if (key) {
        await context.secrets.store('tower.devin.apiKey', key)
        vscode.window.showInformationMessage('Tower: Devin API key saved.')
      }
    }),

    vscode.commands.registerCommand('tower.clearDevinApiKey', async () => {
      await context.secrets.delete('tower.devin.apiKey')
      vscode.window.showInformationMessage('Tower: Devin API key cleared.')
    }),

    // Re-read config when settings change
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tower.claude.path') || e.affectsConfiguration('tower.devin.orgId')) {
        vscode.window
          .showInformationMessage('Tower: Reload window to apply provider changes.', 'Reload')
          .then((choice) => {
            if (choice === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow')
          })
      }
    })
  )
}

export function deactivate() {
  manager?.dispose()
}
