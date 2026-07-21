import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { BilibiliAuthManager } from "../utils/BilibiliAuthManager.js"

test("B站二维码未扫码状态保持等待，只有过期码结束会话", async () => {
  const states = [86101, 86090, 86038]
  const manager = new BilibiliAuthManager({
    file: path.join(os.tmpdir(), `bilibili-auth-test-${process.pid}-${Date.now()}.json`),
    fetchImpl: async () => ({ json: async () => ({ data: { code: states.shift() } }) })
  })
  manager.pending = { key: "test-key", expiresAt: Date.now() + 60_000 }

  assert.equal((await manager.poll()).state, "waiting")
  assert.ok(manager.pending)
  assert.equal((await manager.poll()).state, "waiting")
  assert.ok(manager.pending)
  assert.equal((await manager.poll()).state, "expired")
  assert.equal(manager.pending, null)
})

test("B站二维码成功后仅保存最小授权 Cookie 且权限模式正确", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bilibili-auth-test-"))
  const file = path.join(dir, "auth.json")
  try {
    const manager = new BilibiliAuthManager({
      file,
      fetchImpl: async () => ({
        json: async () => ({
          data: {
            code: 0,
            url: "https://passport.bilibili.com/login/success?SESSDATA=opaque&bili_jct=opaque&DedeUserID=10001"
          }
        })
      })
    })
    manager.pending = { key: "test-key", expiresAt: Date.now() + 60_000 }

    assert.equal((await manager.poll()).state, "success")
    assert.equal(manager.status().authorized, true)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(manager.canUseHighQuality({ isMaster: true }), true)
    assert.equal(manager.canUseHighQuality({ groupId: "1", userId: "2", whitelist: { "1": ["2"] } }), true)
    assert.equal(manager.canUseHighQuality({ groupId: "2", userId: "2", whitelist: { "1": ["2"] } }), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
