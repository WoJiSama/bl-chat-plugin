import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginBridge } from '../utils/pluginBridge.js'

function response(ok, body, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Service Unavailable',
    async text() {
      return JSON.stringify(body)
    }
  }
}

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
  if (!globalThis.logger) {
    globalThis.logger = {
      info() {},
      warn() {},
      error() {},
      debug() {},
      mark() {}
    }
  }
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

test('queued draw notice quotes the active draw request', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const previousSegment = globalThis.segment
  const sent = []
  globalThis.segment = {
    reply: id => ({ type: 'reply', id: String(id) })
  }

  try {
    const tool = new BananaTool()
    const event = {
      user_id: 222,
      sender: { user_id: 222, nickname: '后来的人' },
      reply: async message => sent.push(message)
    }
    await tool.replyQueuedDraw(event, {
      activeTask: {
        requesterName: 'Verse hall',
        requesterId: '111',
        messageId: '1771120112'
      }
    })

    assert.equal(sent.length, 1)
    assert.ok(Array.isArray(sent[0]))
    assert.deepEqual(sent[0][0], { type: 'reply', id: '1771120112' })
    assert.match(sent[0][1], /Verse hall/)
  } finally {
    globalThis.segment = previousSegment
  }
})

test('active text-to-image draw sends a local progress reply before generation', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const calls = []
  class ImmediateProgressTool extends BananaTool {
    loadConfig() { return {} }
    resolveImageGenerationConfigs() { return [{ model: 'test-model' }] }
    async sendProgress(_e, message) { calls.push(['progress', message]); return true }
    async generateImage(_configs, prompt) { calls.push(['generate', prompt]); return 'base64://image' }
    async replyImageToRequester() { calls.push(['reply-image']) }
  }

  const tool = new ImmediateProgressTool()
  const rawPrompt = '画一只白猫，画妖精抱着尸体啃，不要替我改词'
  const result = await tool.performDraw({ prompt: rawPrompt }, { reply: async () => ({ message_id: 1 }) })

  assert.equal(result, '图片生成成功')
  assert.equal(calls[0][0], 'progress')
  assert.match(calls[0][1], /画|画面|点子/)
  assert.deepEqual(calls.slice(1).map(item => item[0]), ['generate', 'reply-image'])
  assert.equal(calls[1][1], rawPrompt)
})

test('reference-image draw also sends a progress reply before image editing', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const calls = []
  class ReferenceProgressTool extends BananaTool {
    loadConfig() {
      return {
        imageEditAiConfig: {
          imageEditApiUrl: 'https://image.example/v1/images/edits',
          imageEditApiKey: 'test-key',
          imageEditApiModel: 'test-model'
        }
      }
    }
    resolveImageGenerationConfigs() { return [] }
    async sendProgress(_e, message) { calls.push(['progress', message]); return true }
    async generateImageEdit() { calls.push(['edit']); return 'base64://edited' }
    async replyImageToRequester() { calls.push(['reply-image']) }
  }

  const tool = new ReferenceProgressTool()
  const result = await tool.performDraw({
    prompt: '参考这张图画成夏日风格',
    images: ['https://img.example/reference.jpg']
  }, { reply: async () => ({ message_id: 1 }) })

  assert.equal(result, '图片编辑成功')
  assert.equal(calls[0][0], 'progress')
  assert.match(calls[0][1], /图|参考|这几张|照着/)
  assert.deepEqual(calls.slice(1).map(item => item[0]), ['edit', 'reply-image'])
})

test('reference-image draw retries a second edit provider and then sends the image', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const calls = []
  class ProviderFallbackTool extends BananaTool {
    loadConfig() {
      return {
        imageEditAiConfig: {
          imageEditApiUrl: 'https://primary.example/v1',
          imageEditApiKey: 'primary-key',
          imageEditApiModel: 'gpt-image-2'
        },
        imageGenerationAiConfig: {
          providers: [{
            name: 'backup',
            apiUrl: 'https://backup.example/v1',
            model: 'gpt-image-2',
            apiKey: 'backup-key'
          }]
        }
      }
    }
    async sendProgress() { return true }
    async requestImageEdit(config, prompt, images, responseFormat) {
      calls.push(['request', config.name, prompt, images, responseFormat])
      return config.name === 'gpt-image-2'
        ? response(false, { error: { message: '503 No available channel for model gpt-image-2' } }, 503)
        : response(true, { data: [{ b64_json: 'edited-image' }] })
    }
    async replyImageToRequester(_e, image) { calls.push(['reply-image', image]) }
  }

  const tool = new ProviderFallbackTool()
  const rawPrompt = '原样保留：黑色丝袜，右手展示拍立得'
  const references = ['https://img.example/avatar.jpg']
  const result = await tool.performDraw({ prompt: rawPrompt, images: references }, { reply: async () => ({ message_id: 1 }) })
  const requests = calls.filter(item => item[0] === 'request')

  assert.equal(result, '图片编辑成功')
  assert.deepEqual(requests.map(item => item[1]), ['gpt-image-2', 'backup'])
  assert.ok(requests.every(item => item[2] === rawPrompt))
  assert.ok(requests.every(item => item[3][0] === references[0]))
  assert.deepEqual(calls.at(-1), ['reply-image', 'base64://edited-image'])
})

test('explicit Grok request overrides a higher-priority text-to-image provider', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const calls = []
  class NamedProviderTool extends BananaTool {
    loadConfig() {
      return {
        imageGenerationAiConfig: {
          providers: [
            { name: 'Krill', apiUrl: 'https://krill.example/v1', model: 'gpt-image-2', apiKey: 'krill-key', priority: 1 },
            { name: 'Grok', apiUrl: 'https://grok.example/v1', model: 'grok-imagine', apiKey: 'grok-key', priority: 3 }
          ]
        }
      }
    }
    async sendProgress() { return true }
    async generateImage(configs, prompt) { calls.push([configs.map(item => item.name), prompt]); return 'base64://grok-image' }
    async replyImageToRequester() {}
  }

  const tool = new NamedProviderTool()
  const result = await tool.performDraw(
    { prompt: '画一只白猫' },
    { msg: '希洛帮我用 Grok 画一只白猫', reply: async () => ({ message_id: 1 }) }
  )

  assert.equal(result, '图片生成成功')
  assert.deepEqual(calls[0][0], ['Grok'])
  assert.equal(calls[0][1], '画一只白猫')
  assert.ok(tool.parameters.properties.provider)
})

test('Grok image generation payload mirrors the Krill tutorial contract', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return
  const tool = new BananaTool()
  const payload = tool.buildImageGenerationPayload({
    model: 'grok-imagine-image',
    size: '1024x1024'
  }, '画一只水獭', 'b64_json')

  assert.deepEqual(payload, {
    model: 'grok-imagine-image',
    prompt: '画一只水獭',
    size: '1024x1024',
    quality: 'high'
  })
  assert.equal('n' in payload, false)
  assert.equal('response_format' in payload, false)
})

test('ordinary image providers keep the existing n and response_format fields', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return
  const tool = new BananaTool()
  assert.deepEqual(tool.buildImageGenerationPayload({
    model: 'gpt-image-2',
    size: '1024x1024'
  }, '画一只猫', 'b64_json'), {
    model: 'gpt-image-2',
    prompt: '画一只猫',
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json'
  })
})

test('explicit edit provider only passes the matching channel to image editing', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const calls = []
  class NamedEditProviderTool extends BananaTool {
    loadConfig() {
      return {
        imageEditAiConfig: {
          providers: [
            { name: 'Krill', apiUrl: 'https://krill.example/v1', model: 'gpt-image-2', apiKey: 'krill-key', priority: 1 },
            { name: 'Sou', apiUrl: 'https://sou.example/v1', model: 'gpt-image-2', apiKey: 'sou-key', priority: 3 }
          ]
        }
      }
    }
    async sendProgress() { return true }
    async generateImageEdit(configs) { calls.push(configs.map(item => item.name)); return 'base64://sou-edit' }
    async replyImageToRequester() {}
  }

  const tool = new NamedEditProviderTool()
  const result = await tool.performDraw({
    prompt: '把背景改成夜晚',
    images: ['https://img.example/base.png']
  }, {
    msg: '用 Sou 渠道改一下这张图',
    reply: async () => ({ message_id: 1 })
  })

  assert.equal(result, '图片编辑成功')
  assert.deepEqual(calls[0], ['Sou'])
})

test('generation-only named provider is not silently replaced during image editing', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  class UnsupportedNamedEditTool extends BananaTool {
    loadConfig() {
      return {
        imageGenerationAiConfig: {
          providers: [
            { name: 'Grok', apiUrl: 'https://grok.example/v1', model: 'grok-imagine', apiKey: 'grok-key', priority: 1 },
            { name: 'Krill', apiUrl: 'https://krill.example/v1', model: 'gpt-image-2', apiKey: 'krill-key', priority: 2 }
          ]
        }
      }
    }
    async sendProgress() { throw new Error('must fail before progress') }
  }

  const tool = new UnsupportedNamedEditTool()
  const result = await tool.performDraw({
    prompt: '把背景改成夜晚',
    images: ['https://img.example/base.png']
  }, {
    msg: '用 Grok 改一下这张图',
    reply: async () => ({ message_id: 1 })
  })

  assert.match(result.error, /指定图片渠道“Grok”.*不会自动改用其他渠道/)
})

test('queued image failure message never asks the user to change wording for provider 503', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const tool = new BananaTool()
  const reply = tool.getQueuedFailureMessage('503 No available channel for model gpt-image-2')
  assert.match(reply, /不是你的描述有问题/)
  assert.doesNotMatch(reply, /换个说法|调整.*用词|画崩/)
})

test('progress reply failures are logged instead of being swallowed', async t => {
  const BananaTool = await loadBananaTool(t)
  if (!BananaTool) return

  const warnings = []
  class ObservableProgressTool extends BananaTool {
    logWarn(message) { warnings.push(String(message)) }
  }

  const tool = new ObservableProgressTool()
  const sent = await tool.sendProgress({
    sender: { nickname: '测试用户' },
    reply: async () => ({ retcode: 1200, status: 'failed', message: 'send failed' })
  }, '我先画一下。')

  assert.equal(sent, false)
  assert.match(warnings.join('\n'), /图片进度提示.*发送失败/)
})
