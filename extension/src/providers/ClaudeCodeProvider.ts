import { spawn, ChildProcess } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { AgentProvider } from './AgentProvider'
import { AgentSession, AgentMessage, AgentStatus } from '../types'

interface RunningProcess {
  proc: ChildProcess
  session: AgentSession
  messageBuffer: AgentMessage[]
  subscribers: Set<(msgs: AgentMessage[]) => void>
  claudeSessionId?: string
}

// Common install locations for the claude CLI, tried in order
const FALLBACK_PATHS = [
  '/usr/local/bin/claude',
  `${process.env.HOME ?? '~'}/.local/bin/claude`,
  `${process.env.HOME ?? '~'}/.npm/bin/claude`,
  `${process.env.HOME ?? '~'}/.npm-global/bin/claude`,
]

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude'

  private processes = new Map<string, RunningProcess>()
  private completedSessions: AgentSession[] = []

  /**
   * @param claudePath Path to the `claude` binary. Defaults to `claude` (expects it in PATH).
   *   Configure via `tower.claude.path` in VS Code settings if the binary is not on PATH.
   */
  constructor(
    private readonly claudePath: string = 'claude',
    private readonly workspacePath?: string
  ) {}

  async listSessions(): Promise<AgentSession[]> {
    const running = Array.from(this.processes.values()).map((r) => r.session)
    return [...running, ...this.completedSessions].sort((a, b) => b.createdAt - a.createdAt)
  }

  async spawnSession(prompt: string, parentId?: string): Promise<AgentSession> {
    const id = uuidv4()
    const now = Date.now()

    const session: AgentSession = {
      id,
      provider: 'claude',
      prompt,
      status: 'running',
      title: prompt.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      parentId,
    }

    const args = ['--output-format', 'stream-json', '--print', prompt]
    const proc = spawn(this.claudePath, args, {
      env: { ...process.env },
      cwd: this.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const entry: RunningProcess = { proc, session, messageBuffer: [], subscribers: new Set() }
    this.processes.set(id, entry)
    this.attachProcessHandlers(id, entry)
    return session
  }

  async stopSession(sessionId: string): Promise<void> {
    const entry = this.processes.get(sessionId)
    if (!entry) return
    entry.proc.kill('SIGTERM')
    this.finalizeSession(sessionId, 'stopped')
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    // Running processes don't accept stdin in --print mode.
    // Queue a follow-up: record the message now and it will be picked up as
    // a new session when the current one finishes (handled by the consumer).
    const entry = this.processes.get(sessionId)
    const msg = this.makeMessage(sessionId, 'user', text)

    if (entry) {
      entry.messageBuffer.push(msg)
      this.notifySubscribers(entry, [msg])
      const note = this.makeMessage(
        sessionId,
        'system',
        'Redirect queued — the agent will pick this up after its current task completes.'
      )
      entry.messageBuffer.push(note)
      this.notifySubscribers(entry, [note])
    }
  }

  subscribeMessages(
    sessionId: string,
    onMessages: (messages: AgentMessage[]) => void
  ): () => void {
    const entry = this.processes.get(sessionId)

    if (!entry) {
      // Completed session — deliver buffer and return
      const completed = this.completedSessions.find((s) => s.id === sessionId)
      if (completed) {
        const msgs = (completed as AgentSession & { __messages?: AgentMessage[] }).__messages ?? []
        if (msgs.length) setTimeout(() => onMessages([...msgs]), 0)
      }
      return () => {}
    }

    if (entry.messageBuffer.length > 0) {
      setTimeout(() => onMessages([...entry.messageBuffer]), 0)
    }
    entry.subscribers.add(onMessages)
    return () => entry.subscribers.delete(onMessages)
  }

  async getInsights(sessionId: string): Promise<string | null> {
    const entry = this.processes.get(sessionId)
    const completed = this.completedSessions.find((s) => s.id === sessionId) as
      | (AgentSession & { __messages?: AgentMessage[] })
      | undefined

    const messages = entry?.messageBuffer ?? completed?.__messages ?? []
    const agentText = messages
      .filter((m) => m.source === 'agent')
      .map((m) => m.text)
      .join('\n')
      .slice(-1000)

    return agentText || null
  }

  private attachProcessHandlers(id: string, entry: RunningProcess) {
    entry.proc.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        this.handleOutputLine(id, entry, line)
      }
    })

    entry.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return
      const msg = this.makeMessage(id, 'system', `[stderr] ${text}`)
      entry.messageBuffer.push(msg)
      this.notifySubscribers(entry, [msg])
    })

    entry.proc.on('close', (code) => {
      const status: AgentStatus = code === 0 ? 'done' : code === null ? 'stopped' : 'errored'
      this.finalizeSession(id, status)
    })

    entry.proc.on('error', (err) => {
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
      const text = isNotFound
        ? `claude CLI not found at "${this.claudePath}". ` +
          `Install Claude Code (https://claude.ai/code) or set tower.claude.path in VS Code settings. ` +
          `Tried fallbacks: ${FALLBACK_PATHS.join(', ')}`
        : `Process error: ${err.message}`

      const msg = this.makeMessage(id, 'system', text)
      entry.messageBuffer.push(msg)
      this.notifySubscribers(entry, [msg])
      this.finalizeSession(id, 'errored')
    })
  }

  private handleOutputLine(id: string, entry: RunningProcess, line: string) {
    let text = line
    let source: AgentMessage['source'] = 'agent'

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>

      if (parsed.type === 'system' && typeof parsed.session_id === 'string') {
        entry.claudeSessionId = parsed.session_id
        return
      }

      if (parsed.type === 'assistant') {
        const content = (parsed.message as Record<string, unknown>)?.content
        if (Array.isArray(content)) {
          text = content
            .filter((b: Record<string, unknown>) => b.type === 'text')
            .map((b: Record<string, unknown>) => b.text as string)
            .join('')
        }
      } else if (parsed.type === 'result') {
        text = (parsed.result as string) ?? ''
        source = 'system'
      } else if (parsed.type === 'tool_use' || parsed.type === 'tool_result') {
        // Tool call details — skip for the side panel; too noisy
        return
      }
    } catch {
      // Raw text line
    }

    if (!text.trim()) return

    entry.session.lastMessage = text.slice(0, 80)
    entry.session.updatedAt = Date.now()

    const msg = this.makeMessage(id, source, text)
    entry.messageBuffer.push(msg)
    this.notifySubscribers(entry, [msg])
  }

  private finalizeSession(id: string, status: AgentStatus) {
    const entry = this.processes.get(id)
    if (!entry) return

    entry.session.status = status
    entry.session.updatedAt = Date.now()

    const completed = {
      ...entry.session,
      __messages: [...entry.messageBuffer],
    } as AgentSession & { __messages: AgentMessage[] }
    this.completedSessions.unshift(completed)

    this.processes.delete(id)

    const msg = this.makeMessage(id, 'system', `Session ${status}.`)
    entry.subscribers.forEach((fn) => fn([msg]))
    entry.subscribers.clear()
  }

  private notifySubscribers(entry: RunningProcess, messages: AgentMessage[]) {
    entry.subscribers.forEach((fn) => fn(messages))
  }

  private makeMessage(
    sessionId: string,
    source: AgentMessage['source'],
    text: string
  ): AgentMessage {
    return { id: uuidv4(), sessionId, source, text, createdAt: Date.now() }
  }
}
