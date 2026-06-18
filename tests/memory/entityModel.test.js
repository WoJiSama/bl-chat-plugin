// tests/memory/entityModel.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEntity, makeAlias, makeFact, slimEntityDoc } from '../../utils/memory/entityModel.js'

test('makeAlias produces slim shape, no bloat fields', () => {
  const a = makeAlias({ text: 'Maela', authority: 'teaching', confidence: 0.9, by: ['1','1'], at: 100 })
  assert.deepEqual(Object.keys(a).sort(), ['at','authority','by','confidence','superseded','text'].sort())
  assert.deepEqual(a.by, ['1']) // deduped
  assert.equal(a.superseded, false)
})

test('makeFact drops sourceMessageIds/embedding/score bloat', () => {
  const f = makeFact({ text: 'likes 原神', tags: ['偏好'], refs: ['2'], authority: 'self', confidence: 0.8, at: 1,
    sourceMessageIds: ['x'], embedding: [1,2], score: 0.5, relevance: 0.3 })
  assert.deepEqual(Object.keys(f).sort(), ['at','authority','confidence','refs','superseded','tags','text'].sort())
})

test('makeEntity normalizes qq to string|null and defaults arrays', () => {
  const e = makeEntity({ qq: 123 })
  assert.equal(e.qq, '123')
  assert.deepEqual(e.aliases, [])
  assert.deepEqual(e.facts, [])
  const e2 = makeEntity({})
  assert.equal(e2.qq, null)
})

test('slimEntityDoc strips legacy/transient fields from loaded data', () => {
  const dirty = { '1': { qq: '1', canonicalName: 'A', aliases: [], facts: [
    { text: 't', authority: 'self', confidence: 0.7, at: 1, tags: [], refs: [], relevance: 0.9, score: 0.5, sourceMessageIds: ['z'] }
  ], updatedAt: 1, relationshipScore: 0.6 } }
  const clean = slimEntityDoc(dirty)
  assert.equal(clean['1'].relationshipScore, undefined)
  assert.equal(clean['1'].facts[0].relevance, undefined)
  assert.equal(clean['1'].facts[0].sourceMessageIds, undefined)
})
