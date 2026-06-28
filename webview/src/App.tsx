import { useState, useEffect, useCallback } from 'react'
import { bridge } from './bridge'
import type { AgentSession, AgentMessage } from './bridge'

type ExtToWebview = import('../../extension/src/types').ExtToWebview

const STATUS_COLOR: Record<string, string> = {
  running: '#22c55e',
  blocked: '#eab308',
  done: '#3b82f6',
  errored: '#ef4444',
  stopped: '#6b7280',
}

export default function App() {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [insights, setInsights] = useState<string | null>(null)
  const [showSpawn, setShowSpawn] = useState(false)
  const [spawnPrompt, setSpawnPrompt] = useState('')
  const [redirectText, setRedirectText] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    const unsub = bridge.onMessage((msg: ExtToWebview) => {
      switch (msg.type) {
        case 'fleetUpdate':
          setSessions(msg.sessions)
          break
        case 'messagesAppend':
          if (msg.sessionId === selected) {
            setMessages((prev) => [...prev, ...msg.messages])
          }
          break
        case 'insightsUpdate':
          if (msg.sessionId === selected) {
            setInsights(msg.summary)
          }
          break
        case 'error':
          showToast(`Error: ${msg.message}`)
          break
      }
    })
    return unsub
  }, [selected])

  const selectSession = useCallback(
    (id: string) => {
      if (selected) bridge.send({ type: 'unsubscribeMessages', sessionId: selected })
      setSelected(id)
      setMessages([])
      setInsights(null)
      bridge.send({ type: 'subscribeMessages', sessionId: id })
      bridge.send({ type: 'getInsights', sessionId: id })
    },
    [selected]
  )

  const spawnAgent = () => {
    if (!spawnPrompt.trim()) return
    bridge.send({ type: 'spawn', prompt: spawnPrompt.trim() })
    setSpawnPrompt('')
    setShowSpawn(false)
    showToast('Agent spawning…')
  }

  const sendRedirect = () => {
    if (!selected || !redirectText.trim()) return
    bridge.send({ type: 'sendMessage', sessionId: selected, text: redirectText.trim() })
    setRedirectText('')
    showToast('Message sent ✓')
  }

  const stopSession = (id: string) => {
    bridge.send({ type: 'stop', sessionId: id })
    if (selected === id) setSelected(null)
  }

  const selectedSession = sessions.find((s) => s.id === selected)

  return (
    <div className="flex h-screen w-full bg-[#0a0e1a] text-white overflow-hidden">
      {/* Canvas / fleet list */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-wide">Tower</h1>
          <button
            onClick={() => setShowSpawn(true)}
            className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-xl font-bold"
            title="Spawn new agent"
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p className="text-4xl mb-3">◎</p>
              <p>No agents online.</p>
              <p className="text-sm">Tap + to spawn.</p>
            </div>
          )}

          {sessions.map((s) => {
            const color = STATUS_COLOR[s.status] ?? '#6b7280'
            const isSelected = s.id === selected
            return (
              <div
                key={s.id}
                onClick={() => selectSession(s.id)}
                className={`rounded-lg p-3 cursor-pointer border transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-950/40'
                    : 'border-gray-700 hover:border-gray-500 bg-gray-900/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: color,
                      boxShadow: s.status === 'running' ? `0 0 8px ${color}` : undefined,
                    }}
                  />
                  <span className="font-medium text-sm truncate flex-1">{s.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ color, border: `1px solid ${color}40` }}>
                    {s.status}
                  </span>
                  <span className="text-xs text-gray-600 ml-1 capitalize">{s.provider}</span>
                </div>
                {s.lastMessage && (
                  <p className="text-xs text-gray-400 mt-1.5 pl-5 truncate">{s.lastMessage}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Side panel */}
      {selectedSession && (
        <div className="w-80 border-l border-gray-800 flex flex-col bg-gray-950/50">
          <div className="p-3 border-b border-gray-800 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{selectedSession.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 capitalize">
                {selectedSession.provider} · {selectedSession.status}
                {selectedSession.acuConsumed != null && ` · ${selectedSession.acuConsumed} ACU`}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => stopSession(selectedSession.id)}
                className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-800/60 text-red-400"
              >
                Stop
              </button>
              <button
                onClick={() => setSelected(null)}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`text-xs rounded p-2 ${
                  m.source === 'user'
                    ? 'bg-blue-900/40 text-blue-200 ml-4'
                    : m.source === 'system'
                    ? 'text-gray-500 italic'
                    : 'bg-gray-800/60 text-gray-200'
                }`}
              >
                <span className="font-medium mr-1 opacity-60">
                  {m.source === 'user' ? 'You' : m.source === 'system' ? '·' : 'Agent'}
                </span>
                {m.text}
              </div>
            ))}
            {messages.length === 0 && (
              <p className="text-xs text-gray-600 italic text-center pt-4">Waiting for output…</p>
            )}
          </div>

          {/* Insights */}
          {insights && (
            <div className="p-3 border-t border-gray-800 text-xs text-gray-400 bg-gray-900/30">
              <p className="font-semibold text-gray-300 mb-1">AI Summary</p>
              <p className="line-clamp-3">{insights}</p>
            </div>
          )}

          {/* Redirect input */}
          <div className="p-3 border-t border-gray-800">
            <div className="flex gap-2">
              <input
                className="flex-1 bg-gray-800 rounded px-2 py-1.5 text-xs placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Redirect agent…"
                value={redirectText}
                onChange={(e) => setRedirectText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendRedirect()}
              />
              <button
                onClick={sendRedirect}
                className="text-xs px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 font-medium"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spawn modal */}
      {showSpawn && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-[480px] shadow-2xl">
            <h2 className="font-bold text-lg mb-4">Spawn Agent</h2>
            <textarea
              autoFocus
              className="w-full h-32 bg-gray-800 rounded-lg p-3 text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              placeholder="Describe the task for this agent…"
              value={spawnPrompt}
              onChange={(e) => setSpawnPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) spawnAgent()
                if (e.key === 'Escape') setShowSpawn(false)
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setShowSpawn(false)}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={spawnAgent}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium"
              >
                Spawn ⌘↵
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 text-sm px-4 py-2 rounded-full shadow-lg border border-gray-600">
          {toast}
        </div>
      )}
    </div>
  )
}
