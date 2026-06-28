export type AgentStatus = 'running' | 'blocked' | 'done' | 'errored' | 'stopped'
export type ProviderName = 'claude' | 'devin'

export interface AgentSession {
  id: string
  provider: ProviderName
  prompt: string
  status: AgentStatus
  title: string
  createdAt: number
  updatedAt: number
  lastMessage?: string
  parentId?: string
  // Devin-specific
  url?: string
  acuConsumed?: number
}

export interface AgentMessage {
  id: string
  sessionId: string
  source: 'agent' | 'user' | 'system'
  text: string
  createdAt: number
}

// Messages from webview → extension host
export type WebviewToExt =
  | { type: 'ping' }
  | { type: 'spawn'; prompt: string; provider?: ProviderName }
  | { type: 'stop'; sessionId: string }
  | { type: 'sendMessage'; sessionId: string; text: string }
  | { type: 'subscribeMessages'; sessionId: string }
  | { type: 'unsubscribeMessages'; sessionId: string }
  | { type: 'getInsights'; sessionId: string }
  | { type: 'fork'; sessionId: string; instruction: string }

// Messages from extension host → webview
export type ExtToWebview =
  | { type: 'pong' }
  | { type: 'fleetUpdate'; sessions: AgentSession[] }
  | { type: 'messagesAppend'; sessionId: string; messages: AgentMessage[] }
  | { type: 'insightsUpdate'; sessionId: string; summary: string }
  | { type: 'error'; message: string }
