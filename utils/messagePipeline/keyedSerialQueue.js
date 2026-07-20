export class KeyedSerialQueue {
  constructor() {
    this.tails = new Map()
  }

  run(key, work) {
    const queueKey = String(key || "default")
    const previous = this.tails.get(queueKey) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    this.tails.set(queueKey, current)
    current.finally(() => {
      if (this.tails.get(queueKey) === current) this.tails.delete(queueKey)
    }).catch(() => {})
    return current
  }

  get size() {
    return this.tails.size
  }
}

export class AsyncSemaphore {
  constructor(limit = 4) {
    this.limit = Math.max(1, Number(limit) || 4)
    this.active = 0
    this.waiters = []
  }

  async run(work) {
    if (this.active >= this.limit) {
      await new Promise(resolve => this.waiters.push(resolve))
    }
    this.active++
    try {
      return await work()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}
