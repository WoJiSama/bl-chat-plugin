// tests/memory/extractor.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAndRoute } from '../../utils/memory/extractor.js'

const ctx = { speakerQQ: '925640859', at: 1000 }

test('explicit_teaching with alias+targetQQ -> alias op authority teaching', () => {
  const ops = parseAndRoute([
    { route: 'explicit_teaching', alias: 'maela', targetQQ: '3188163302', confidence: 0.9 }
  ], ctx)
  assert.equal(ops.length, 1)
  assert.equal(ops[0].stream, 'alias')
  assert.equal(ops[0].authority, 'teaching')
  assert.equal(ops[0].qq, '3188163302')
  assert.equal(ops[0].text, 'maela')
})

test('self_statement name -> speaker alias authority self', () => {
  const ops = parseAndRoute([
    { route: 'self_statement', alias: '咖啡大人', confidence: 0.9 }
  ], ctx)
  assert.equal(ops[0].stream, 'alias')
  assert.equal(ops[0].authority, 'self')
  assert.equal(ops[0].qq, '925640859') // attaches to speaker
})

test('user_preference -> speaker entity fact tag 偏好', () => {
  const ops = parseAndRoute([
    { route: 'user_preference', content: '不喜欢被叫全名', confidence: 0.8 }
  ], ctx)
  assert.equal(ops[0].stream, 'entityFact')
  assert.equal(ops[0].qq, '925640859')
  assert.ok(ops[0].fact.tags.includes('偏好'))
})

test('group_consensus -> group fact authority mention', () => {
  const ops = parseAndRoute([
    { route: 'group_consensus', content: '群里不要刷屏', tags: ['群规'], confidence: 0.8 }
  ], ctx)
  assert.equal(ops[0].stream, 'groupFact')
  assert.equal(ops[0].authority, 'mention')
})

test('ordinary_chat and unknown routes are dropped', () => {
  const ops = parseAndRoute([
    { route: 'ordinary_chat', content: '哈哈' },
    { route: 'bogus', content: 'x' },
    null,
    { route: 'self_statement' } // no alias/content
  ], ctx)
  assert.equal(ops.length, 0)
})
