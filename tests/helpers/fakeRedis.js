export function createFakeRedis() {
  const data = new Map()
  const expiresAt = new Map()

  const purge = key => {
    const expiry = expiresAt.get(key)
    if (expiry && expiry <= Date.now()) {
      data.delete(key)
      expiresAt.delete(key)
    }
  }

  return {
    data,
    expiresAt,
    async get(key) {
      purge(key)
      return data.get(key) ?? null
    },
    async set(key, value, options = {}) {
      purge(key)
      if (options.NX && data.has(key)) return null
      if (options.XX && !data.has(key)) return null
      data.set(key, String(value))
      if (options.PX) expiresAt.set(key, Date.now() + Number(options.PX))
      else if (options.EX) expiresAt.set(key, Date.now() + Number(options.EX) * 1000)
      else expiresAt.delete(key)
      return "OK"
    },
    async del(key) {
      expiresAt.delete(key)
      return data.delete(key) ? 1 : 0
    },
    async eval(script, { keys = [], arguments: args = [] } = {}) {
      const key = keys[0]
      purge(key)
      if (String(data.get(key) ?? "") !== String(args[0] ?? "")) return 0
      if (script.includes("PEXPIRE")) {
        expiresAt.set(key, Date.now() + Number(args[1]))
        return 1
      }
      if (script.includes("DEL")) {
        expiresAt.delete(key)
        data.delete(key)
        return 1
      }
      return 0
    },
    async *scanIterator({ MATCH = "*" } = {}) {
      const prefix = MATCH.replace(/\*$/, "")
      for (const key of [...data.keys()]) {
        purge(key)
        if (data.has(key) && key.startsWith(prefix)) yield key
      }
    }
  }
}
