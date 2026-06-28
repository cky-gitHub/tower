import type { WebviewToExt, ExtToWebview } from '../../extension/src/types'

// Re-export types for webview consumers
export type { AgentSession, AgentMessage } from '../../extension/src/types'

type MessageListener = (msg: ExtToWebview) => void

// VS Code webview API (injected at runtime)
declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExt): void
  getState(): unknown
  setState(state: unknown): void
}

function createBridge() {
  // VS Code webview environment
  if (typeof acquireVsCodeApi !== 'undefined') {
    const vscode = acquireVsCodeApi()
    const listeners = new Set<MessageListener>()

    window.addEventListener('message', (event: MessageEvent<ExtToWebview>) => {
      listeners.forEach((fn) => fn(event.data))
    })

    return {
      send(msg: WebviewToExt) {
        vscode.postMessage(msg)
      },
      onMessage(listener: MessageListener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }

  // JetBrains JCEF fallback (legacy)
  if (typeof window !== 'undefined' && (window as any).towerBridge) {
    const jb = (window as any).towerBridge as {
      call: (name: string, payload: unknown) => Promise<string>
    }
    return {
      send(msg: WebviewToExt) {
        jb.call(msg.type, msg).catch(console.error)
      },
      onMessage(_listener: MessageListener) {
        // JB bridge uses callbacks registered per-handler; not used in VS Code mode
        return () => {}
      },
    }
  }

  // Dev mode — log only
  return {
    send(msg: WebviewToExt) {
      console.log('[bridge] →', msg)
    },
    onMessage(listener: MessageListener) {
      // Allow dev tools to trigger messages via window.__fakeBridgeMessage
      ;(window as any).__fakeBridgeMessage = listener
      return () => { delete (window as any).__fakeBridgeMessage }
    },
  }
}

export const bridge = createBridge()
