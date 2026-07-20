import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveMessageCacheTtlSeconds } from "../utils/messageCacheTtl.js"

test("近期消息 Redis TTL 默认使用一小时", () => {
  assert.equal(resolveMessageCacheTtlSeconds(), 60 * 60)
})

test("近期消息 Redis TTL 支持分钟配置并优先于旧天级配置", () => {
  assert.equal(resolveMessageCacheTtlSeconds({ cacheExpireMinutes: 15 }), 15 * 60)
  assert.equal(resolveMessageCacheTtlSeconds({ cacheExpireMinutes: 60, cacheExpireDays: 1 }), 60 * 60)
})

test("近期消息 Redis TTL 保持旧天级配置和最小一分钟兼容", () => {
  assert.equal(resolveMessageCacheTtlSeconds({ cacheExpireDays: 1 }), 24 * 60 * 60)
  assert.equal(resolveMessageCacheTtlSeconds({ cacheExpireSeconds: 1 }), 60)
})
