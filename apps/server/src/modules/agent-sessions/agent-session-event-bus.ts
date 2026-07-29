import type { AgentSessionEvent } from "./agent-session.domain.js"

type AgentSessionEventListener = (event: AgentSessionEvent) => void

export class AgentSessionEventBus {
  private readonly listeners = new Map<
    string,
    Set<AgentSessionEventListener>
  >()

  publish(event: AgentSessionEvent): void {
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      listener(event)
    }
  }

  subscribe(
    sessionId: string,
    listener: AgentSessionEventListener,
  ): () => void {
    const sessionListeners =
      this.listeners.get(sessionId) ?? new Set<AgentSessionEventListener>()
    sessionListeners.add(listener)
    this.listeners.set(sessionId, sessionListeners)

    return () => {
      sessionListeners.delete(listener)
      if (sessionListeners.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }
}
