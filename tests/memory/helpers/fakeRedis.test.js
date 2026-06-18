// tests/memory/helpers/fakeRedis.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeRedis } from './fakeRedis.js'

test('fakeRedis get/set/del round-trips strings', async () => {
  const r = createFakeRedis()
  assert.equal(await r.get('k'), null)
  await r.set('k', 'v')
  assert.equal(await r.get('k'), 'v')
  await r.del('k')
  assert.equal(await r.get('k'), null)
})

test('fakeRedis set with {EX} keeps value (ttl ignored in tests)', async () => {
  const r = createFakeRedis()
  await r.set('k', 'v', { EX: 60 })
  assert.equal(await r.get('k'), 'v')
})

test('fakeRedis scanIterator yields matching keys', async () => {
  const r = createFakeRedis()
  await r.set('ytbot:mem:g:1:entities', '{}')
  await r.set('ytbot:mem:g:1:alias', '{}')
  await r.set('other', 'x')
  const seen = []
  for await (const key of r.scanIterator({ MATCH: 'ytbot:mem:g:1:*' })) seen.push(key)
  assert.deepEqual(seen.sort(), ['ytbot:mem:g:1:alias', 'ytbot:mem:g:1:entities'])
})
