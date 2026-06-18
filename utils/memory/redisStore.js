// utils/memory/redisStore.js
import { KEY } from './constants.js'
import { slimEntityDoc, slimGroupFacts } from './entityModel.js'

function safeParse(raw, fallback) {
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

const DEFAULT_META = { disabled: false, lastExtractAt: 0, nextRetryAt: 0, failureCount: 0 }

export class RedisStore {
  // 注入 redis 以便单测；生产默认用全局 redis
  constructor({ redis = globalThis.redis } = {}) {
    this.redis = redis
  }

  async _setRaw(key, value) {
    await this.redis.set(key, value)
  }

  async _getJson(key, fallback) {
    return safeParse(await this.redis.get(key), fallback)
  }

  async getEntities(groupId) {
    return slimEntityDoc(await this._getJson(KEY.entities(groupId), {}))
  }
  async saveEntities(groupId, doc) {
    await this._setRaw(KEY.entities(groupId), JSON.stringify(slimEntityDoc(doc)))
  }

  async getAlias(groupId) {
    return await this._getJson(KEY.alias(groupId), {}) || {}
  }
  async saveAlias(groupId, doc) {
    await this._setRaw(KEY.alias(groupId), JSON.stringify(doc || {}))
  }

  async getFacts(groupId) {
    return slimGroupFacts(await this._getJson(KEY.facts(groupId), []))
  }
  async saveFacts(groupId, facts) {
    await this._setRaw(KEY.facts(groupId), JSON.stringify(slimGroupFacts(facts)))
  }

  async getMeta(groupId) {
    return { ...DEFAULT_META, ...(await this._getJson(KEY.meta(groupId), {}) || {}) }
  }
  async saveMeta(groupId, meta) {
    await this._setRaw(KEY.meta(groupId), JSON.stringify({ ...DEFAULT_META, ...(meta || {}) }))
  }

  async clearGroup(groupId) {
    const keys = [KEY.entities(groupId), KEY.alias(groupId), KEY.facts(groupId), KEY.meta(groupId)]
    for (const k of keys) await this.redis.del(k)
    return keys.length
  }
}
