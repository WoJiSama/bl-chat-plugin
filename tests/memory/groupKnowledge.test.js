import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryManager } from '../../utils/MemoryManager.js'
import { extractExplicitGroupKnowledge, findGroupKnowledgeDeletionCandidates, parseSemanticGroupKnowledgeOutput } from '../../utils/memory/groupKnowledge.js'
import { createFakeRedis } from './helpers/fakeRedis.js'

function memberMap() {
  return new Map([
    [1, { user_id: 1, card: '希洛' }],
    [9, { user_id: 9, card: '沃基' }],
    [2, { user_id: 2, card: '甲' }],
    [3, { user_id: 3, card: '乙' }]
  ])
}

function mapTeaching() {
  return extractExplicitGroupKnowledge({
    text: '希洛，群文件里面的地图世界.zip是我做的地图',
    memberMap: memberMap(),
    fileAssets: [{ type: 'file', fileName: '地图世界.zip', fileId: 'file-1', origin: 'current', source: 'https://temporary.example/file' }],
    creatorQQ: '9',
    botId: '1',
    now: 100
  })
}

test('stores a group file definition with stable file identity and owner, not a temporary URL', () => {
  const entries = mapTeaching()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'group_file')
  assert.equal(entries[0].subject, '地图')
  assert.equal(entries[0].ownerQQ, '9')
  assert.equal(entries[0].resource.fileName, '地图世界.zip')
  assert.equal(entries[0].resource.fileId, 'file-1')
  assert.equal('source' in entries[0].resource, false)
})

test('answers a natural first-person group-file query only for the defined owner and keeps groups isolated', async () => {
  const manager = new MemoryManager({ enabled: true }, { redis: createFakeRedis() })
  await manager.upsertGroupKnowledgeEntries('g1', mapTeaching())
  const prompt = await manager.getGroupKnowledgePrompt('g1', { speakerQQ: '9', message: '希洛，我群里面的地图是什么' })
  assert.match(prompt, /地图世界\.zip/)
  assert.match(prompt, /当前发言者/)
  assert.equal(await manager.getGroupKnowledgePrompt('g1', { speakerQQ: '2', message: '我的地图是什么' }), '')
  assert.equal(await manager.getGroupKnowledgePrompt('g2', { speakerQQ: '9', message: '我的地图是什么' }), '')
})

test('records one or many named members as a reusable group definition', async () => {
  const entries = extractExplicitGroupKnowledge({
    text: '@甲 和 @乙 是美术组',
    messageSegments: [{ type: 'at', data: { qq: '2' } }, { type: 'at', data: { qq: '3' } }],
    memberMap: memberMap(),
    botId: '1',
    now: 100
  })
  assert.equal(entries[0].kind, 'member_set')
  assert.equal(entries[0].subject, '美术组')
  assert.deepEqual(entries[0].targetUserIds, ['2', '3'])

  const manager = new MemoryManager({ enabled: true }, { redis: createFakeRedis() })
  const saved = await manager.upsertGroupKnowledgeEntries('g', entries)
  const prompt = await manager.getGroupKnowledgePrompt('g', { speakerQQ: '9', message: '美术组是谁' })
  assert.match(prompt, /甲\(QQ:2\).*乙\(QQ:3\)/)
  assert.equal((await manager.adminDeleteGroupKnowledge({ groupId: 'g', id: saved.entries[0].id })).deleted, true)
  assert.equal((await manager.getGroupKnowledgeEntries('g')).length, 0)
})

test('resolves my relationship to the current speaker instead of storing the pronoun', async () => {
  const teaching = '希洛群里的星野是我的星怒你记住了'
  const entries = extractExplicitGroupKnowledge({
    text: teaching,
    memberMap: new Map([...memberMap(), [4, { user_id: 4, card: '星野' }]]),
    creatorQQ: '9',
    creatorDisplay: '沃基',
    botId: '1'
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].subject, '星怒')
  assert.equal(entries[0].ownerQQ, '9')
  assert.equal(entries[0].targets[0].userId, '4')

  const manager = new MemoryManager({ enabled: true }, { redis: createFakeRedis() })
  await manager.upsertGroupKnowledgeEntries('g', entries)
  const prompt = await manager.getGroupKnowledgePrompt('g', { speakerQQ: '9', message: '我群里的星怒是谁' })
  assert.match(prompt, /当前发言者的“星怒”指的是：星野/)
})

test('model semantic output resolves pronouns through provided speaker and live member context', () => {
  const members = new Map([...memberMap(), [4, { user_id: 4, card: '星野' }]])
  const entries = parseSemanticGroupKnowledgeOutput(JSON.stringify([
    { kind: 'member_definition', subject: '星怒', owner: 'speaker', targetNames: ['星野'] }
  ]), {
    text: '希洛群里的星野是我的星怒你记住了',
    memberMap: members,
    creatorQQ: '9',
    creatorDisplay: '沃基',
    botId: '1'
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].ownerQQ, '9')
  assert.equal(entries[0].targets[0].userId, '4')
})

test('ordinary chat without a resource or named member definition does not create group knowledge', () => {
  assert.deepEqual(extractExplicitGroupKnowledge({ text: '这个地图是我昨天做的，真累', memberMap: memberMap(), creatorQQ: '9' }), [])
})

test('forgets only the requesting user\'s uniquely named group knowledge', async () => {
  const manager = new MemoryManager({ enabled: true }, { redis: createFakeRedis() })
  const mine = {
    kind: 'group_file', subject: '地图', subjectKey: '地图', aliases: ['我的地图', '地图'],
    ownerQQ: '9', ownerDisplay: '沃基', targetUserIds: [], targets: [], resource: { fileName: '我的地图.zip' },
    createdBy: '9', sourceText: '地图是我做的', at: 100, enabled: true
  }
  const theirs = { ...mine, ownerQQ: '2', ownerDisplay: '甲', resource: { fileName: '甲的地图.zip' }, createdBy: '2', sourceText: '地图是甲做的', at: 101 }
  const saved = await manager.upsertGroupKnowledgeEntries('g', [mine, theirs])
  assert.equal(saved.entries.length, 2)
  const candidates = findGroupKnowledgeDeletionCandidates(await manager.getGroupKnowledgeEntries('g'), {
    query: '我的地图', speakerQQ: '9', createdBy: '9'
  })
  assert.equal(candidates.length, 1)
  const result = await manager.forgetGroupKnowledge({ groupId: 'g', requesterQQ: '9', query: '我的地图' })
  assert.equal(result.deleted, true)
  assert.equal((await manager.getGroupKnowledgeEntries('g')).length, 1)
  assert.equal((await manager.getGroupKnowledgeEntries('other')).length, 0)
})

test('does not delete an ambiguous or foreign group knowledge entry', async () => {
  const manager = new MemoryManager({ enabled: true }, { redis: createFakeRedis() })
  const base = {
    kind: 'member_definition', subject: '搭档', subjectKey: '搭档', aliases: ['搭档'], ownerQQ: '',
    targetUserIds: ['2'], targets: [{ userId: '2', displayName: '甲' }], createdBy: '9', at: 100, enabled: true
  }
  await manager.upsertGroupKnowledgeEntries('g', [base, { ...base, kind: 'member_set', targetUserIds: ['3'], targets: [{ userId: '3', displayName: '乙' }], at: 101 }])
  const ambiguous = await manager.forgetGroupKnowledge({ groupId: 'g', requesterQQ: '9', query: '搭档' })
  assert.equal(ambiguous.reason, 'ambiguous')
  assert.equal((await manager.getGroupKnowledgeEntries('g')).length, 2)
  const foreign = await manager.forgetGroupKnowledge({ groupId: 'g', requesterQQ: '2', query: '搭档' })
  assert.equal(foreign.reason, 'not-found')
  assert.equal((await manager.getGroupKnowledgeEntries('g')).length, 2)
})
