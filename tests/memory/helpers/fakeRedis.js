// tests/memory/helpers/fakeRedis.js
function matchToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function createFakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    _store: store,
    async get(key) {
      return store.has(key) ? store.get(key) : null
    },
    async set(key, value) {
      store.set(key, String(value))
    },
    async del(...keys) {
      for (const key of keys.flat()) store.delete(key)
    },
    async keys(pattern) {
      const re = matchToRegExp(pattern)
      return [...store.keys()].filter(k => re.test(k))
    },
    async *scanIterator({ MATCH = '*' } = {}) {
      const re = matchToRegExp(MATCH)
      for (const key of [...store.keys()]) {
        if (re.test(key)) yield key
      }
    }
  }
}
