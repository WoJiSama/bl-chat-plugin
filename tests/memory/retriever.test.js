// tests/memory/retriever.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAliasPrompt, buildEntityPrompt, buildGroupFactsPrompt } from '../../utils/memory/retriever.js'

const aliasDoc = {
  'maela': { qq: '3188163302', authority: 'teaching', confidence: 0.9, at: 2, display: 'maela' },
  '希洛':  { qq: '925640859',  authority: 'self',     confidence: 0.9, at: 1, display: '希洛' }
}

test('buildAliasPrompt lists mappings and is empty when no aliases', () => {
  const p = buildAliasPrompt(aliasDoc, '', 1200)
  assert.ok(p.includes('maela'))
  assert.ok(p.includes('3188163302'))
  assert.equal(buildAliasPrompt({}, '', 1200), '')
})

test('buildAliasPrompt prefers query-matched alias', () => {
  const p = buildAliasPrompt(aliasDoc, 'maela是谁', 1200)
  assert.ok(p.includes('maela'))
})

test('buildEntityPrompt formats name/aliases/facts, skips superseded', () => {
  const entity = { qq: '1', canonicalName: '咖啡大人', aliases: [
      { text: '咖啡', authority: 'self', confidence: 0.9, at: 1, superseded: false },
      { text: '旧名', authority: 'mention', confidence: 0.5, at: 0, superseded: true }
    ], facts: [{ text: '在上海', tags: [], refs: [], authority: 'self', confidence: 0.8, at: 1, superseded: false }] }
  const p = buildEntityPrompt(entity, 1200)
  assert.ok(p.includes('咖啡大人'))
  assert.ok(p.includes('咖啡'))
  assert.ok(!p.includes('旧名'))
  assert.ok(p.includes('在上海'))
})

test('buildGroupFactsPrompt sorts by confidence and caps by chars', () => {
  const facts = [
    { text: 'A群规', tags: ['群规'], authority: 'mention', confidence: 0.5, at: 1, superseded: false },
    { text: 'B重要', tags: [], authority: 'mention', confidence: 0.9, at: 2, superseded: false }
  ]
  const p = buildGroupFactsPrompt(facts, '', 2, 1200)
  assert.ok(p.indexOf('B重要') < p.indexOf('A群规'))
})
