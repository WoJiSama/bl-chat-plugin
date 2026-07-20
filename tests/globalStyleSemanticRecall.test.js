import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GlobalStyleLearnerManager } from '../utils/GlobalStyleLearnerManager.js'

const embeddingConfig = {
  embeddingApiUrl: 'https://embedding.invalid/v1/embeddings',
  embeddingApiKey: 'test-key',
  embeddingApiModel: 'test-embedding'
}

function response(vector) {
  return { ok: true, status: 200, json: async () => ({ data: [{ embedding: vector }] }) }
}

async function waitForSemanticIdle(manager) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!manager.semanticQueue.length && manager.semanticQueueRunning === 0) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('semantic queue did not become idle')
}

function createManager(fetchFn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'style-semantic-'))
  const manager = new GlobalStyleLearnerManager({ cwd, fetchFn, logger: { warn() {}, info() {} } })
  const config = {
    baseDir: 'data/style',
    flushIntervalMs: 5000,
    minSamplesForPrompt: 1,
    semanticMinSamples: 2,
    semanticSampleLimit: 2,
    semanticPromptExamples: 2,
    semanticSimilarityThreshold: 0.7,
    semanticEmbedTimeoutMs: 500
  }
  return { cwd, manager, config }
}

test('semantic recall injects only anonymous relevant style patterns', async () => {
  const { cwd, manager, config } = createManager(async (_url, options) => {
    const input = JSON.parse(options.body).input
    return response(/离谱|绷|笑死/.test(input) ? [1, 0] : [0, 1])
  })
  try {
    manager.observeMessage({ group_id: 1, user_id: 2, message_id: 1, msg: '笑死，这下真绷不住了' }, config, embeddingConfig)
    manager.observeMessage({ group_id: 1, user_id: 3, message_id: 2, msg: '这个接口报错了怎么办？' }, config, embeddingConfig)
    await waitForSemanticIdle(manager)

    const memory = manager.readMemory(config)
    assert.equal(memory.semanticSamples.length, 2)
    assert.ok(memory.semanticSamples.every(item => !('text' in item)))

    const prompt = await manager.buildRelevantPrompt(config, { query: '这也太离谱了', embeddingConfig })
    assert.match(prompt, /先用一句自然短反应接住情绪/)
    assert.doesNotMatch(prompt, /笑死，这下真绷不住了/)
    assert.doesNotMatch(prompt, /接口报错/)
  } finally {
    manager.flushTimer && clearTimeout(manager.flushTimer)
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('semantic recall filters low similarity and coalesces duplicate background embeddings', async () => {
  let calls = 0
  const { cwd, manager, config } = createManager(async (_url, options) => {
    calls += 1
    const input = JSON.parse(options.body).input
    return response(input.includes('技术') ? [0, 1] : [1, 0])
  })
  try {
    const sample = {
      hash: manager.hashText('笑死，这下真绷不住了'),
      text: '笑死，这下真绷不住了',
      patterns: ['先用一句自然短反应接住情绪，再进入实际回应；保持友好，不阴阳怪气。'],
      sequence: false
    }
    manager.enqueueSemanticSample(sample, config, embeddingConfig)
    manager.enqueueSemanticSample(sample, config, embeddingConfig)
    manager.observeMessage({ group_id: 1, user_id: 3, message_id: 3, msg: '这个技术问题为什么报错？' }, config, embeddingConfig)
    await waitForSemanticIdle(manager)
    assert.equal(manager.readMemory(config).semanticSamples.length, 2)
    assert.equal(calls, 2)

    const prompt = await manager.buildRelevantPrompt(config, { query: '技术问题又报错了', embeddingConfig })
    assert.match(prompt, /排查问题时先说已确认的现象/)
    assert.doesNotMatch(prompt, /先用一句自然短反应接住情绪/)
  } finally {
    manager.flushTimer && clearTimeout(manager.flushTimer)
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('semantic query failure returns no extra prompt and preserves existing global prompt', async () => {
  const { cwd, manager, config } = createManager(async (_url, options) => {
    const input = JSON.parse(options.body).input
    if (input.includes('查询失败')) throw new Error('upstream unavailable')
    return response(input.includes('笑死') ? [1, 0] : [0, 1])
  })
  try {
    manager.observeMessage({ group_id: 1, user_id: 2, message_id: 1, msg: '笑死，这下真绷不住了' }, config, embeddingConfig)
    manager.observeMessage({ group_id: 1, user_id: 3, message_id: 2, msg: '这个技术问题为什么报错？' }, config, embeddingConfig)
    await waitForSemanticIdle(manager)

    const memory = manager.readMemory(config)
    memory.totalSamples = 10
    memory.essence.short_first = 1
    const basePrompt = manager.buildPrompt(config)
    const semanticPrompt = await manager.buildRelevantPrompt(config, { query: '查询失败怎么办', embeddingConfig })
    assert.match(basePrompt, /希洛全局表达学习/)
    assert.equal(semanticPrompt, '')
  } finally {
    manager.flushTimer && clearTimeout(manager.flushTimer)
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('first observed message backfills existing sanitized style samples in the background', async () => {
  const { cwd, manager, config } = createManager(async (_url, options) => {
    const input = JSON.parse(options.body).input
    return response(input.includes('报错') ? [0, 1] : [1, 0])
  })
  try {
    const memory = manager.readMemory(config)
    memory.samplePool = [
      { text: '笑死，这下真绷不住了', sequence: false },
      { text: '这个接口报错了怎么办？', sequence: false }
    ]
    manager.observeMessage({ group_id: 1, user_id: 2, message_id: 1, msg: '很抱歉，我不能帮你' }, config, embeddingConfig)
    await waitForSemanticIdle(manager)
    const stored = manager.readMemory(config).semanticSamples
    assert.equal(stored.length, 2)
    assert.ok(stored.some(item => item.patterns.some(pattern => pattern.includes('接住情绪'))))
    assert.ok(stored.some(item => item.patterns.some(pattern => pattern.includes('排查问题'))))
    assert.ok(manager.semanticBackfillScheduled)
  } finally {
    manager.flushTimer && clearTimeout(manager.flushTimer)
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
