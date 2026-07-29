import type { AgentRuntimeSession } from "../agent-session.domain.js"

export class ActiveAgentSessionRegistry {
  private readonly sessions = new Map<string, AgentRuntimeSession>()

  get(sessionId: string): AgentRuntimeSession | undefined {
    return this.sessions.get(sessionId)
  }

  set(sessionId: string, session: AgentRuntimeSession): void {
    const previous = this.sessions.get(sessionId)
    if (previous && previous !== session) {
      previous.close()
    }
    this.sessions.set(sessionId, session)
  }

  delete(sessionId: string, session?: AgentRuntimeSession): void {
    if (session && this.sessions.get(sessionId) !== session) return
    this.sessions.delete(sessionId)
  }

  closeAndDelete(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    session?.close()
    this.sessions.delete(sessionId)
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close()
    }
    this.sessions.clear()
  }
}
