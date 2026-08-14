import type { TestRunEvent } from "./test-run.domain.js"

type Listener = (event: TestRunEvent) => void

export class TestRunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly globalListeners = new Set<Listener>()

  subscribe(runId: string, listener: Listener): () => void {
    const runListeners = this.listeners.get(runId) ?? new Set<Listener>()
    runListeners.add(listener)
    this.listeners.set(runId, runListeners)
    return () => {
      runListeners.delete(listener)
      if (runListeners.size === 0) this.listeners.delete(runId)
    }
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  publish(events: readonly TestRunEvent[]): void {
    for (const event of events) {
      for (const listener of this.globalListeners) listener(event)
      for (const listener of this.listeners.get(event.runId) ?? []) {
        listener(event)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
    this.globalListeners.clear()
  }
}
