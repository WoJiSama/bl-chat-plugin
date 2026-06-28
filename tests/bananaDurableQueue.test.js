import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginBridge } from '../utils/pluginBridge.js'

function createFakeRedis() {
  const data = new Map()
  return {
    data,
    async get(key) {
      return data.get(key) || null
    },
    async set(key, value) {
      data.set(key, value)
      return 'OK'
    },
    async del(...keys) {
      let count = 0
      for (const key of keys) {
        if (data.delete(key)) count += 1
      }
      return count
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '')
      return [...data.keys()].filter(key => key.startsWith(prefix))
    }
  }
}

async function loadBananaTool(t) {
  try {
    return (await import('../functions/functions_tools/BananaTool.js')).BananaTool
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip(`runtime dependency is not installed in this checkout: ${error.message}`)
      return null
    }
    throw error
  }
}

test('banana durable queue restores unfinished draw job after restart', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const previousRedis = globalThis.redis
  const previousBot = globalThis.Bot
  const previousInstance = pluginBridge.instance
  const fakeRedis = createFakeRedis()
  const sent = []

  globalThis.redis = fakeRedis
  globalThis.Bot = {
    uin: 3094088525,
    pickGroup: groupId => ({
      sendMsg: async message => {
        sent.push({ groupId, message })
      }
    })
  }
  pluginBridge.instance = { getTaskStatusTtlSeconds: () => 3600 }

  try {
    const firstTool = new BananaTool()
    const event = {
      group_id: 725902146,
      user_id: 925640859,
      message_id: 1771120112,
      message_type: 'group',
      sender: { user_id: 925640859, nickname: '测试用户' },
      reply: async message => sent.push({ groupId: 725902146, message })
    }
    const job = {
      id: 'job-1',
      opts: { prompt: '画一只白色小猫' },
      e: event,
      scopeKey: firstTool.getDrawScopeKey(event),
      requesterName: '测试用户',
      requesterId: '925640859',
      messageId: '1771120112',
      queuedAt: Date.now()
    }

    await firstTool.persistDrawJob(job)
    assert.ok(fakeRedis.data.has('ytbot:image_draw_job:job-1'))

    class RecoveringBananaTool extends BananaTool {
      recoveredJob = null
      async runDrawJob(recoveredJob) {
        this.recoveredJob = recoveredJob
        await this.removeDurableDrawJob(recoveredJob)
        return '图片生成成功'
      }
    }

    const recoveredTool = new RecoveringBananaTool()
    await recoveredTool.recoverDurableJobs()
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(recoveredTool.recoveredJob?.id, 'job-1')
    assert.equal(recoveredTool.recoveredJob?.e.group_id, 725902146)
    assert.equal(recoveredTool.recoveredJob?.e.user_id, 925640859)
    assert.equal(recoveredTool.recoveredJob?.opts.prompt, '画一只白色小猫')
    assert.equal(fakeRedis.data.has('ytbot:image_draw_job:job-1'), false)
    assert.ok(String(sent[0]?.message || '').includes('继续画'))
  } finally {
    globalThis.redis = previousRedis
    globalThis.Bot = previousBot
    pluginBridge.instance = previousInstance
  }
})

test('safe image prompt rewrite does not force comic style unless requested', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const tool = new BananaTool()
  const normal = tool.sanitizePromptForImageGeneration('画一个写实电影感人物，包含敏感内容')
  assert.ok(normal.includes('安全改写后的绘图需求'))
  assert.ok(normal.includes('单张完整画面'))
  assert.ok(normal.includes('不要擅自改成漫画'))
  assert.ok(!normal.includes('多格恋爱喜剧漫画'))
  assert.ok(!normal.includes('二次元漫画风'))

  const comic = tool.sanitizePromptForImageGeneration('画成四格漫画，包含敏感内容')
  assert.ok(comic.includes('多格连环画/漫画分镜'))
  assert.ok(!comic.includes('不要擅自改成漫画'))
})
