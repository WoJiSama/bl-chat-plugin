// tests/memory/manager.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './helpers/fakeRedis.js'
import { MemoryManager } from '../../utils/MemoryManager.js'

function mgr(redis) {
  const m = new MemoryManager({ enabled: true }, { redis })
  return m
}

test('applyOps writes alias and entity, retrievable via prompts', async () => {
  const redis = createFakeRedis()
  const m = mgr(redis)
  await m.applyOps('981339693', [
    { stream: 'alias', qq: '3188163302', text: 'maela', authority: 'teaching', confidence: 0.9, by: ['925640859'], at: 1 },
    { stream: 'entityFact', qq: '925640859', authority: 'self', fact: { text: '在上海', tags: [], refs: [], authority: 'self', confidence: 0.8, at: 1, superseded: false } }
  ])
  const alias = await m.getGroupAliasPrompt('981339693', 'maela 是谁')
  assert.ok(alias.includes('maela'))
  assert.ok(alias.includes('3188163302'))
  const userPrompt = await m.getMemoryPromptForUser('981339693', '925640859', '')
  assert.ok(userPrompt.includes('在上海'))
})

test('conflicting alias resolves by authority across applyOps calls', async () => {
  const m = mgr(createFakeRedis())
  await m.applyOps('g', [{ stream: 'alias', qq: '3188163302', text: '希洛', authority: 'mention', confidence: 0.8, by: ['x'], at: 1 }])
  await m.applyOps('g', [{ stream: 'alias', qq: '925640859', text: '希洛', authority: 'self', confidence: 0.9, by: ['925640859'], at: 2 }])
  const doc = await m.store.getAlias('g')
  assert.equal(doc['希洛'].qq, '925640859')
})

test('disabled group blocks writes and prompts', async () => {
  const m = mgr(createFakeRedis())
  await m.adminSetGroupMemoryEnabled({ groupId: 'g', enabled: false })
  await m.applyOps('g', [{ stream: 'groupFact', authority: 'mention', fact: { text: 'x', tags: [], refs: [], authority: 'mention', confidence: 0.8, at: 1, superseded: false } }])
  assert.equal(await m.getGroupMemoryPrompt('g', ''), '')
})

test('adminClearMemories wipes the group', async () => {
  const m = mgr(createFakeRedis())
  await m.applyOps('g', [{ stream: 'groupFact', authority: 'mention', fact: { text: 'x', tags: [], refs: [], authority: 'mention', confidence: 0.8, at: 1, superseded: false } }])
  const r = await m.adminClearMemories({ scope: 'group', groupId: 'g' })
  assert.ok(r.cleared >= 1)
  assert.equal(await m.getGroupMemoryPrompt('g', ''), '')
})
