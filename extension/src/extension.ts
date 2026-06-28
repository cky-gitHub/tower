import * as vscode from 'vscode'
import { AgentManager } from './AgentManager'
import { TowerPanel } from './TowerPanel'
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider'
import { DevinProvider } from './providers/DevinProvider'

let manager: AgentManager | undefined

export function activate(context: vscode.ExtensionContext) {
  manager = new AgentManager()

  // Always register Claude Code provider
  manager.register(new ClaudeCodeProvider())

  // Register Devin provider if credentials are configured
  const cfg = vscode.workspace.getConfiguration('tower')
  const orgId = cfg.get<string>('devin.orgId') ?? ''
  if (orgId) {
    manager.register(
      new DevinProvider(
        () => context.secrets.get('tower.devin.apiKey').then((k) => k ?? '') as unknown as string,
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
      })
      if (key) {
        await context.secrets.store('tower.devin.apiKey', key)
        vscode.window.showInformationMessage('Tower: Devin API key saved.')
      }
    }),

    vscode.commands.registerCommand('tower.clearDevinApiKey', async () => {
      await context.secrets.delete('tower.devin.apiKey')
      vscode.window.showInformationMessage('Tower: Devin API key cleared.')
    })
  )
}

export function deactivate() {
  manager?.dispose()
}
