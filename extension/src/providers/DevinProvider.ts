import { v4 as uuidv4 } from 'uuid'
import { AgentProvider } from './AgentProvider'
import { AgentSession, AgentMessage } from '../types'

const BASE = 'https://api.devin.ai/v3'

interface DevinSession {
  session_id: string
  status: string
  title: string | null
  prompt?: string
  created_at: number
  updated_at: number
  url: string
  acus_consumed: number
  parent_session_id: string | null
  status_detail: string | null
}

interface DevinMessage {
  event_id: string
  source: string
  message: string
  created_at: number
}

export class DevinProvider implements AgentProvider {
  readonly name = 'devin'
  private cursors = new Map<string, string>()
  private pollIntervals = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private readonly getApiKey: () => string,
    private readonly getOrgId: () => string
  ) {}

  async listSessions(): Promise<AgentSession[]> {
    const data = await this.get<{ sessions: DevinSession[] }>('sessions')
    return (data.sessions ?? []).map(this.mapSession)
  }

  async spawnSession(prompt: string, parentId?: string): Promise<AgentSession> {
    const body: Record<string, string> = { prompt }
    if (parentId) body.parent_session_id = parentId
    const data = await this.post<DevinSession>('sessions', body)
    return this.mapSession(data)
  }

  async stopSession(sessionId: string): Promise<void> {
    this.clearPoll(sessionId)
    await this.delete(`sessions/${sessionId}`)
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    await this.post(`sessions/${sessionId}/messages`, { message: text })
  }

  subscribeMessages(
    sessionId: string,
    onMessages: (messages: AgentMessage[]) => void
  ): () => void {
    this.cursors.delete(sessionId)

    const poll = async () => {
      try {
        const cursor = this.cursors.get(sessionId)
        const qs = cursor ? `?cursor=${cursor}` : ''
        const data = await this.get<{ items: DevinMessage[]; end_cursor: string | null }>(
          `sessions/${sessionId}/messages${qs}`
        )
        if (data.items?.length) {
          onMessages(data.items.map((m) => this.mapMessage(sessionId, m)))
        }
        if (data.end_cursor) {
          this.cursors.set(sessionId, data.end_cursor)
        }
      } catch {
        // swallow — session may have ended
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    this.pollIntervals.set(sessionId, interval)

    return () => this.clearPoll(sessionId)
  }

  async getInsights(sessionId: string): Promise<string | null> {
    try {
      const data = await this.get<{ summary: string }>(`sessions/${sessionId}/insights`)
      return data.summary ?? null
    } catch {
      try {
        const data = await this.post<{ summary: string }>(
          `sessions/${sessionId}/insights/generate`,
          {}
        )
        return data.summary ?? null
      } catch {
        return null
      }
    }
  }

  private clearPoll(sessionId: string) {
    const interval = this.pollIntervals.get(sessionId)
    if (interval) {
      clearInterval(interval)
      this.pollIntervals.delete(sessionId)
    }
  }

  private mapSession = (s: DevinSession): AgentSession => ({
    id: s.session_id,
    provider: 'devin',
    prompt: s.title ?? '',
    status: this.mapStatus(s.status),
    title: s.title ?? s.session_id.slice(0, 8),
    createdAt: s.created_at * 1000,
    updatedAt: s.updated_at * 1000,
    url: s.url,
    acuConsumed: s.acus_consumed,
    parentId: s.parent_session_id ?? undefined,
  })

  private mapMessage(sessionId: string, m: DevinMessage): AgentMessage {
    return {
      id: m.event_id,
      sessionId,
      source: m.source === 'user' ? 'user' : 'agent',
      text: m.message,
      createdAt: m.created_at * 1000,
    }
  }

  private mapStatus(s: string): AgentSession['status'] {
    if (s === 'running') return 'running'
    if (s === 'blocked' || s === 'suspended') return 'blocked'
    if (s === 'finished' || s === 'completed') return 'done'
    if (s === 'failed') return 'errored'
    if (s === 'stopped') return 'stopped'
    return 'running'
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
    }
  }

  private orgPath(path: string) {
    return `${BASE}/organizations/${this.getOrgId()}/${path}`
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.orgPath(path), { headers: this.headers() })
    if (!res.ok) throw new Error(`Devin API ${res.status}: ${path}`)
    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const res = await fetch(this.orgPath(path), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Devin API ${res.status}: POST ${path}`)
    return res.json() as Promise<T>
  }

  private async delete(path: string): Promise<void> {
    const res = await fetch(this.orgPath(path), {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`Devin API ${res.status}: DELETE ${path}`)
  }
}
