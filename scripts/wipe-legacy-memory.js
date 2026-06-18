// scripts/wipe-legacy-memory.js
// 用法：在 Yunzai 进程内或具备全局 redis 的环境运行；或 node 直连 redis 后注入。
// 作用：删除旧记忆系统遗留键（ytbot:memory:*，含 v2:*）。新系统用 ytbot:mem:g:*，不受影响。
export async function wipeLegacyMemory(redis = globalThis.redis, { dryRun = true } = {}) {
  const pattern = 'ytbot:memory:*'
  const keys = []
  if (typeof redis.scanIterator === 'function') {
    for await (const k of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) keys.push(...(Array.isArray(k) ? k : [k]))
  } else {
    keys.push(...(await redis.keys(pattern)))
  }
  if (dryRun) return { wouldDelete: keys.length, sample: keys.slice(0, 10) }
  for (const k of keys) await redis.del(k)
  return { deleted: keys.length }
}
