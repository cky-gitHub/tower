declare global {
  interface Window {
    towerBridge?: {
      call: (name: string, payload: unknown) => Promise<string>
    }
  }
}

export const bridge = {
  async call(name: string, payload: unknown = null): Promise<string> {
    if (!window.towerBridge) {
      throw new Error('Tower bridge is not ready')
    }

    return window.towerBridge.call(name, payload)
  },
}

export {}
