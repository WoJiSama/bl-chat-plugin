import fs from "fs"
import path from "path"
import { execFileSync } from "child_process"
import {
  enrichBilibiliMessageSegments,
  formatBilibiliHistoryLinks,
  formatBilibiliHistoryText
} from "../utils/bilibiliMessage.js"

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback
}

const groupId = readArg("group")
const messageId = readArg("message")
if (!/^\d+$/.test(groupId)) throw new Error("需要 --group 群号")
if (messageId && !/^\d+$/.test(messageId)) throw new Error("--message 必须是消息 ID")

function matches(record) {
  return !messageId || String(record?.message_id || "") === messageId
}

async function enrichRecord(record) {
  if (!matches(record)) return { record, changed: false }
  const message = await enrichBilibiliMessageSegments(record.message, record.raw_message || "")
  const changed = message.some(segment => segment?.type === "bilibili")
  return changed ? { record: { ...record, message }, changed: true } : { record, changed: false }
}

async function backfillArchive() {
  const dir = path.join(process.cwd(), "data/message_archive/group", groupId)
  const files = (await fs.promises.readdir(dir).catch(() => []))
    .filter(name => name.endsWith(".ndjson"))
    .sort()
  let changed = 0

  for (const name of files) {
    const file = path.join(dir, name)
    const original = await fs.promises.readFile(file, "utf8")
    const lines = original.split(/\r?\n/)
    const output = []
    let fileChanged = false
    for (const line of lines) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        output.push(line)
        continue
      }
      const result = await enrichRecord(record)
      output.push(JSON.stringify(result.record))
      if (result.changed) {
        changed++
        fileChanged = true
      }
    }
    if (!fileChanged) continue
    const stat = await fs.promises.stat(file)
    const temp = `${file}.bilibili-${process.pid}.tmp`
    await fs.promises.writeFile(temp, `${output.join("\n")}\n`, { mode: stat.mode })
    await fs.promises.rename(temp, file)
  }
  return changed
}

async function backfillRedis() {
  const key = `ytbot:messages:group:${groupId}`
  const raw = execFileSync("redis-cli", ["--raw", "GET", key], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim()
  if (!raw) return 0
  const records = JSON.parse(raw)
  let changed = 0
  for (let index = 0; index < records.length; index++) {
    const result = await enrichRecord(records[index])
    if (!result.changed) continue
    const card = result.record.message.find(segment => segment?.type === "bilibili")
    const links = formatBilibiliHistoryLinks(card)
    result.record.content = links
      ? `${formatBilibiliHistoryText(card)} [${links}]`
      : formatBilibiliHistoryText(card)
    records[index] = result.record
    changed++
  }
  if (!changed) return 0

  const ttl = Number(execFileSync("redis-cli", ["--raw", "TTL", key], { encoding: "utf8" }).trim())
  const args = ["SET", key, JSON.stringify(records)]
  if (ttl > 0) args.push("EX", String(ttl))
  execFileSync("redis-cli", args, { stdio: "ignore", maxBuffer: 32 * 1024 * 1024 })
  return changed
}

const archiveChanged = await backfillArchive()
const redisChanged = await backfillRedis()
console.log(JSON.stringify({ groupId, messageId: messageId || null, archiveChanged, redisChanged }))
