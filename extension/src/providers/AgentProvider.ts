import { AgentSession, AgentMessage } from '../types'

export interface AgentProvider {
  readonly name: string

  /** List all known sessions (fleet state). */
  listSessions(): Promise<AgentSession[]>

  /** Spawn a new agent with the given prompt. Returns the new session. */
  spawnSession(prompt: string, parentId?: string): Promise<AgentSession>

  /** Terminate a session. */
  stopSession(sessionId: string): Promise<void>

  /** Send a redirect message to a running session. */
  sendMessage(sessionId: string, text: string): Promise<void>

  /**
   * Subscribe to message updates for a session.
   * The callback is called with new messages as they arrive.
   * Returns a cleanup function to stop polling/streaming.
   */
  subscribeMessages(
    sessionId: string,
    onMessages: (messages: AgentMessage[]) => void
  ): () => void

  /**
   * Get a human-readable summary of what the agent is doing.
   * May return null if not supported or not yet available.
   */
  getInsights?(sessionId: string): Promise<string | null>
}
