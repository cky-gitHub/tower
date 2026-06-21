import { useState } from 'react'
import { bridge } from './bridge'

export default function App() {
  const [response, setResponse] = useState('Not tested')

  async function pingBridge() {
    try {
      const result = await bridge.call('ping')
      setResponse(result)
    } catch (error) {
      setResponse(error instanceof Error ? error.message : 'Unknown bridge error')
    }
  }

  return (
    <div className="w-full h-screen bg-gray-900 text-white flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div>
          <h1 className="text-4xl font-bold mb-4">Tower M2</h1>
          <p className="text-gray-400">JS ↔ Kotlin bridge validation</p>
        </div>
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
          onClick={pingBridge}
          type="button"
        >
          Ping bridge
        </button>
        <p className="text-sm text-gray-300">Response: {response}</p>
      </div>
    </div>
  )
}
