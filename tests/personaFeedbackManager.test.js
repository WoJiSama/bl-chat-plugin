import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PersonaFeedbackManager } from '../utils/PersonaFeedbackManager.js'

test('softens hard robot or human identity denial', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const output = manager.guardReply('不是机器人啦……活人一个😂 就是话多了一点', {
    enabled: true
  }, {
    userText: '你怎么这么像机器人啊'
  })

  assert.equal(output, '别给我扣机器人帽子……我只是话多一点。')
  assert.doesNotMatch(output, /活人|真人|不是机器人/)
})

test('keeps normal replies unchanged', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const output = manager.guardReply('你少来，我只是刚好看到消息了。', {
    enabled: true
  })

  assert.equal(output, '你少来，我只是刚好看到消息了。')
})

test('handles hard denial variants only for bot identity challenges', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const context = { userText: '希洛你不会是 AI 吧', botNames: ['希洛'] }

  assert.equal(
    manager.guardReply('我才不是AI呢，真人一个。', { enabled: true }, context),
    '别给我扣机器人帽子……我只是话多一点。'
  )
  assert.equal(
    manager.guardReply('谁是机器人啊，我可是活人一个！你少来。', { enabled: true }, context),
    '别给我扣机器人帽子……你少来。'
  )
})

test('does not corrupt image authenticity or ordinary human-related content', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const cases = [
    ['这张图是不是AI生成的', '这是真人照片，不像 AI 生成。'],
    ['NPC 属性怎么算', '真人玩家按当前属性计算，NPC 再做上下浮动。'],
    ['介绍一下这部电影', '这是真人出演，不是机器人题材。']
  ]

  for (const [userText, reply] of cases) {
    assert.equal(manager.guardReply(reply, { enabled: true }, { userText }), reply)
  }
})

test('deescalates replies when the user criticizes the tone', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const context = { userText: '你跟哪学的，怎么感觉阴阳怪气的' }

  assert.equal(
    manager.guardReply('嘿嘿，别气嘛…我那不也是一时嘴快嘛😋', { enabled: true }, context),
    '你说得对，刚才那几句有点顶着你说了，听着确实不舒服。我收一下。'
  )
  assert.equal(
    manager.guardReply('你说得对，刚才语气没收住，听着确实不舒服。我改。❤', { enabled: true }, context),
    '你说得对，刚才语气没收住，听着确实不舒服。我改。'
  )
})

test('keeps playful banter outside explicit tone criticism', () => {
  const manager = new PersonaFeedbackManager({ logger: null })
  const reply = '你少来，我就开个玩笑😋'

  assert.equal(manager.guardReply(reply, { enabled: true }, { userText: '哈哈你又开始了' }), reply)
})
