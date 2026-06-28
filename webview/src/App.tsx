import { useState, useEffect, useCallback, useRef } from 'react'
import { bridge } from './bridge'
import type { AgentSession, AgentMessage } from './bridge'
import Canvas from './Canvas'

type ExtToWebview = import('../../extension/src/types').ExtToWebview

export default function App() {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [insights, setInsights] = useState<string | null>(null)
  const [showSpawn, setShowSpawn] = useState(false)
  const [spawnPrompt, setSpawnPrompt] = useState('')
  const [redirectText, setRedirectText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Scroll messages to bottom on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const unsub = bridge.onMessage((msg: ExtToWebview) => {
      switch (msg.type) {
        case 'fleetUpdate':
          setSessions(msg.sessions)
          break
        case 'messagesAppend':
          if (msg.sessionId === selectedId) {
            setMessages((prev) => [...prev, ...msg.messages])
          }
          break
        case 'insightsUpdate':
          if (msg.sessionId === selectedId) setInsights(msg.summary)
          break
        case 'error':
          showToast(`Error: ${msg.message}`)
          break
      }
    })
    return unsub
  }, [selectedId, showToast])

  // Keyboard shortcut: ⌘N / Ctrl+N to spawn
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        setShowSpawn(true)
      }
      if (e.key === 'Escape') {
        setShowSpawn(false)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const selectSession = useCallback(
    (id: string) => {
      if (selectedId) bridge.send({ type: 'unsubscribeMessages', sessionId: selectedId })
      setSelectedId(id)
      setMessages([])
      setInsights(null)
      bridge.send({ type: 'subscribeMessages', sessionId: id })
      bridge.send({ type: 'getInsights', sessionId: id })
    },
    [selectedId]
  )

  const spawnAgent = useCallback(() => {
    const prompt = spawnPrompt.trim()
    if (!prompt) return
    bridge.send({ type: 'spawn', prompt })
    setSpawnPrompt('')
    setShowSpawn(false)
    showToast('Agent spawning…')
  }, [spawnPrompt, showToast])

  const sendRedirect = useCallback(() => {
    if (!selectedId || !redirectText.trim()) return
    bridge.send({ type: 'sendMessage', sessionId: selectedId, text: redirectText.trim() })
    setRedirectText('')
    showToast('Message sent ✓')
  }, [selectedId, redirectText, showToast])

  const stopSession = useCallback(
    (id: string) => {
      bridge.send({ type: 'stop', sessionId: id })
      if (selectedId === id) setSelectedId(null)
    },
    [selectedId]
  )

  const selectedSession = sessions.find((s) => s.id === selectedId)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0e1a] text-white">
      {/* Main canvas */}
      <div className="flex-1 min-w-0 relative">
        <Canvas
          sessions={sessions}
          selectedId={selectedId}
          onSelect={selectSession}
          onSpawn={() => setShowSpawn(true)}
        />
      </div>

      {/* Side panel */}
      {selectedSession && (
        <div className="w-72 flex-shrink-0 border-l border-gray-800 flex flex-col bg-[#0d1117]">
          {/* Header */}
          <div className="p-3 border-b border-gray-800">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate leading-tight">{selectedSession.title}</p>
                <p className="text-[10px] text-gray-500 mt-0.5 capitalize">
                  {selectedSession.provider} · {selectedSession.status}
                  {selectedSession.acuConsumed != null && ` · ${selectedSession.acuConsumed} ACU`}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => stopSession(selectedSession.id)}
                  className="text-[10px] px-2 py-1 rounded bg-red-950/60 hover:bg-red-900/60 text-red-400 border border-red-900/40"
                >
                  Stop
                </button>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-[10px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {/* Message stream */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {messages.length === 0 && (
              <p className="text-[10px] text-gray-700 italic text-center pt-6">
                Waiting for output…
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`text-[11px] rounded px-2 py-1.5 leading-relaxed ${
                  m.source === 'user'
                    ? 'bg-blue-900/30 text-blue-200 ml-3'
                    : m.source === 'system'
                    ? 'text-gray-600 italic text-[10px]'
                    : 'bg-gray-800/50 text-gray-200'
                }`}
              >
                {m.source !== 'system' && (
                  <span className="font-medium opacity-50 mr-1">
                    {m.source === 'user' ? 'You' : 'Agent'}
                  </span>
                )}
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Insights */}
          {insights && (
            <div className="px-3 py-2 border-t border-gray-800 bg-gray-950/50">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Summary
              </p>
              <p className="text-[11px] text-gray-400 line-clamp-4 leading-relaxed">{insights}</p>
            </div>
          )}

          {/* Redirect */}
          <div className="p-2 border-t border-gray-800">
            <div className="flex gap-1.5">
              <input
                className="flex-1 bg-gray-800/80 rounded px-2.5 py-1.5 text-xs placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
                placeholder="Redirect agent…"
                value={redirectText}
                onChange={(e) => setRedirectText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendRedirect()}
              />
              <button
                onClick={sendRedirect}
                className="text-xs px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 font-medium flex-shrink-0"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spawn modal */}
      {showSpawn && (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20"
          onClick={(e) => e.target === e.currentTarget && setShowSpawn(false)}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-[440px] shadow-2xl">
            <h2 className="font-semibold text-base mb-1">Spawn Agent</h2>
            <p className="text-xs text-gray-500 mb-4">
              Describe the task. Claude Code will handle it in your workspace.
            </p>
            <textarea
              autoFocus
              className="w-full h-28 bg-gray-800 rounded-lg p-3 text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              placeholder="e.g. Write unit tests for src/auth/login.ts using the existing test patterns"
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
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={spawnAgent}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium"
              >
                Spawn <span className="opacity-50 ml-1 text-xs">⌘↵</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-800 text-xs px-4 py-2 rounded-full shadow-xl border border-gray-700 z-30 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  )
}
