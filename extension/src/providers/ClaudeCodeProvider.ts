import { spawn, ChildProcess } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { AgentProvider } from './AgentProvider'
import { AgentSession, AgentMessage, AgentStatus } from '../types'

interface RunningProcess {
  proc: ChildProcess
  session: AgentSession
  messageBuffer: AgentMessage[]
  subscribers: Set<(msgs: AgentMessage[]) => void>
  claudeSessionId?: string // captured from stream-json output
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude'

  private processes = new Map<string, RunningProcess>()
  private completedSessions = new Map<string, AgentSession>()

  async listSessions(): Promise<AgentSession[]> {
    const running = Array.from(this.processes.values()).map((r) => r.session)
    const done = Array.from(this.completedSessions.values())
    return [...running, ...done].sort((a, b) => b.createdAt - a.createdAt)
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
    const proc = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const entry: RunningProcess = {
      proc,
      session,
      messageBuffer: [],
      subscribers: new Set(),
    }
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
    const entry = this.processes.get(sessionId)
    if (!entry) {
      // Session completed — resume it with the new instruction
      const completed = this.completedSessions.get(sessionId)
      if (!(completed as any)?.claudeSessionId) {
        throw new Error('Cannot redirect: session not found or no Claude session ID captured')
      }
      await this.spawnSession(text, sessionId)
      return
    }

    // For a running process, we append a user message to the buffer
    // and pipe it to stdin (claude CLI accepts continuation via stdin in interactive mode,
    // but in --print mode we note this as a queued redirect and re-spawn when done)
    const msg = this.makeMessage(sessionId, 'user', text)
    entry.messageBuffer.push(msg)
    this.notifySubscribers(entry, [msg])

    const systemMsg = this.makeMessage(
      sessionId,
      'system',
      'Redirect queued — will apply when current task completes or you stop and resume the session.'
    )
    entry.messageBuffer.push(systemMsg)
    this.notifySubscribers(entry, [systemMsg])
  }

  subscribeMessages(
    sessionId: string,
    onMessages: (messages: AgentMessage[]) => void
  ): () => void {
    const entry = this.processes.get(sessionId)
    if (!entry) {
      // Completed session — deliver buffer once
      const completed = this.completedSessions.get(sessionId)
      if (completed) {
        const historical = (completed as any).__messages as AgentMessage[] | undefined
        if (historical?.length) {
          setTimeout(() => onMessages(historical), 0)
        }
      }
      return () => {}
    }

    // Deliver existing buffer immediately, then subscribe for new ones
    if (entry.messageBuffer.length > 0) {
      setTimeout(() => onMessages([...entry.messageBuffer]), 0)
    }
    entry.subscribers.add(onMessages)
    return () => entry.subscribers.delete(onMessages)
  }

  async getInsights(sessionId: string): Promise<string | null> {
    // For Claude Code we synthesize insights from recent output lines
    const entry = this.processes.get(sessionId)
    const completed = this.completedSessions.get(sessionId)
    const messages =
      entry?.messageBuffer ??
      ((completed as any)?.__messages as AgentMessage[] | undefined) ??
      []

    const agentLines = messages
      .filter((m) => m.source === 'agent')
      .map((m) => m.text)
      .join('\n')
      .slice(-800)

    if (!agentLines) return null
    return agentLines
  }

  private attachProcessHandlers(id: string, entry: RunningProcess) {
    const { proc, session } = entry

    proc.stdout?.on('data', (data: Buffer) => {
      const raw = data.toString()
      // Try to parse stream-json lines; fall back to raw text
      for (const line of raw.split('\n').filter(Boolean)) {
        this.handleOutputLine(id, entry, line)
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return
      const msg = this.makeMessage(id, 'system', `[stderr] ${text}`)
      entry.messageBuffer.push(msg)
      this.notifySubscribers(entry, [msg])
    })

    proc.on('close', (code) => {
      const status: AgentStatus = code === 0 ? 'done' : code === null ? 'stopped' : 'errored'
      this.finalizeSession(id, status)
    })

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const msg = this.makeMessage(
          id,
          'system',
          'claude CLI not found. Install Claude Code: https://claude.ai/code'
        )
        entry.messageBuffer.push(msg)
        this.notifySubscribers(entry, [msg])
      }
      this.finalizeSession(id, 'errored')
    })
  }

  private handleOutputLine(id: string, entry: RunningProcess, line: string) {
    let text = line
    let source: AgentMessage['source'] = 'agent'

    // Claude Code stream-json format: each line is a JSON object
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === 'system' && parsed.session_id) {
        entry.claudeSessionId = parsed.session_id
        ;(entry.session as any).claudeSessionId = parsed.session_id
        return // don't render system init line
      }
      if (parsed.type === 'assistant' && parsed.message?.content) {
        const content = parsed.message.content
        if (Array.isArray(content)) {
          text = content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('')
        } else {
          text = String(content)
        }
      } else if (parsed.type === 'result') {
        text = parsed.result ?? ''
        source = 'system'
      } else {
        text = line
      }
    } catch {
      // Not JSON — raw text output
    }

    if (!text.trim()) return

    // Update the session's lastMessage for the node label
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

    // Move to completed map, preserving the message buffer
    const completed = { ...entry.session }
    ;(completed as any).__messages = [...entry.messageBuffer]
    if (entry.claudeSessionId) {
      ;(completed as any).claudeSessionId = entry.claudeSessionId
    }
    this.completedSessions.set(id, completed)
    this.processes.delete(id)

    // Notify any still-active subscribers of the final status
    entry.subscribers.forEach((fn) => {
      const msg = this.makeMessage(id, 'system', `Session ${status}.`)
      fn([msg])
    })
    entry.subscribers.clear()
  }

  private notifySubscribers(entry: RunningProcess, messages: AgentMessage[]) {
    entry.subscribers.forEach((fn) => fn(messages))
  }

  private makeMessage(sessionId: string, source: AgentMessage['source'], text: string): AgentMessage {
    return { id: uuidv4(), sessionId, source, text, createdAt: Date.now() }
  }
}
