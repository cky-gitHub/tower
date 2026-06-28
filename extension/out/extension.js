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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const AgentManager_1 = require("./AgentManager");
const TowerPanel_1 = require("./TowerPanel");
const ClaudeCodeProvider_1 = require("./providers/ClaudeCodeProvider");
const DevinProvider_1 = require("./providers/DevinProvider");
let manager;
function activate(context) {
    manager = new AgentManager_1.AgentManager();
    const cfg = vscode.workspace.getConfiguration('tower');
    const claudePath = cfg.get('claude.path')?.trim() || 'claude';
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    manager.register(new ClaudeCodeProvider_1.ClaudeCodeProvider(claudePath, workspacePath));
    const orgId = cfg.get('devin.orgId')?.trim() ?? '';
    if (orgId) {
        manager.register(new DevinProvider_1.DevinProvider(() => Promise.resolve(context.secrets.get('tower.devin.apiKey')).then((k) => k ?? ''), () => vscode.workspace.getConfiguration('tower').get('devin.orgId') ?? ''));
    }
    manager.startFleetPoll();
    // Auto-open Tower in column 2 so it's immediately visible on the right
    TowerPanel_1.TowerPanel.createOrShow(context.extensionUri, manager);
    context.subscriptions.push(vscode.commands.registerCommand('tower.open', () => {
        TowerPanel_1.TowerPanel.createOrShow(context.extensionUri, manager);
    }), vscode.commands.registerCommand('tower.setDevinApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Devin API key (cog_...)',
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) => (v.startsWith('cog_') ? null : 'Key should start with cog_'),
        });
        if (key) {
            await context.secrets.store('tower.devin.apiKey', key);
            vscode.window.showInformationMessage('Tower: Devin API key saved.');
        }
    }), vscode.commands.registerCommand('tower.clearDevinApiKey', async () => {
        await context.secrets.delete('tower.devin.apiKey');
        vscode.window.showInformationMessage('Tower: Devin API key cleared.');
    }), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tower.claude.path') ||
            e.affectsConfiguration('tower.devin.orgId')) {
            vscode.window
                .showInformationMessage('Tower: Reload window to apply provider changes.', 'Reload')
                .then((choice) => {
                if (choice === 'Reload')
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
            });
        }
    }));
}
function deactivate() {
    manager?.dispose();
}
//# sourceMappingURL=extension.js.map