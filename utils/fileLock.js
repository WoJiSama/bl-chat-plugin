import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export async function withFileLock(file, work, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  ensureDir(path.dirname(file))
  const startedAt = Date.now()
  const token = `${process.pid}:${startedAt}:${crypto.randomBytes(6).toString("hex")}`
  let handle
  while (!handle) {
    try {
      handle = fs.openSync(file, "wx", 0o600)
      fs.writeFileSync(handle, token, "utf8")
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      try {
        const stat = fs.statSync(file)
        if (Date.now() - stat.mtimeMs > staleMs) fs.unlinkSync(file)
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) throw new Error("状态正被另一个进程使用，请稍后重试")
      await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)))
    }
  }
  try {
    return await work()
  } finally {
    try { fs.closeSync(handle) } catch {}
    try {
      if (fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file)
    } catch {}
  }
}
