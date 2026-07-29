export class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) {
      throw new Error("Cannot enqueue a message after the queue is closed.")
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }

    this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const value = this.values.shift()
        if (value !== undefined) {
          return { done: false, value }
        }

        if (this.closed) {
          return { done: true, value: undefined }
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}
