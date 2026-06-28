import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeVoiceText, selectVoiceStyle } from '../utils/qqVoiceAudio.js'
import { parseVolcengineAudioPayload, VolcengineVoiceProvider } from '../utils/VolcengineVoiceProvider.js'

test('sanitizeVoiceText removes markup and limits spoken text', () => {
  const text = sanitizeVoiceText('[CQ:at,qq=1] **希洛** `console.log(1)` ![图](http://x) 你好呀', 12)
  assert.equal(text, '希洛 console.l')
})

test('selectVoiceStyle keeps one base voice with style hints', () => {
  assert.equal(selectVoiceStyle('唔，你别这样说啦', { shy: {} }), 'shy')
  assert.equal(selectVoiceStyle('你少来，别闹', { tease: {} }), 'tease')
  assert.equal(selectVoiceStyle('我认真解释一下原因', { serious: {} }), 'serious')
  assert.equal(selectVoiceStyle('正常一句话', {}), 'normal')
})

test('VolcengineVoiceProvider builds V3 request headers and body', () => {
  const provider = new VolcengineVoiceProvider({
    endpoint: 'https://example.test/tts',
    appId: 'app',
    accessToken: 'token',
    resourceId: 'seed-icl-2.0',
    voiceType: 'xiluo',
    format: 'mp3',
    sampleRate: 24000
  })
  const req = provider.buildRequest({ text: '你好', style: { speedRatio: 0.94, emotion: 'shy' } })
  assert.equal(req.endpoint, 'https://example.test/tts')
  assert.equal(req.headers['X-Api-App-Id'], 'app')
  assert.equal(req.headers['X-Api-Access-Key'], 'token')
  assert.equal(req.headers['X-Api-Resource-Id'], 'seed-icl-2.0')
  assert.equal(req.body.req_params.text, '你好')
  assert.equal(req.body.req_params.speaker, 'xiluo')
  assert.equal(req.body.req_params.audio_params.format, 'mp3')
  assert.equal(req.body.req_params.audio_params.speech_rate, 0.94)
  assert.equal(req.body.req_params.additions.emotion, 'shy')
})

test('parseVolcengineAudioPayload collects SSE base64 audio chunks', () => {
  const a = Buffer.from('hello ')
  const b = Buffer.from('voice')
  const payload = [
    `data: ${JSON.stringify({ data: a.toString('base64') })}`,
    `data: ${JSON.stringify({ audio_data: b.toString('base64') })}`
  ].join('\n')
  const result = parseVolcengineAudioPayload(Buffer.from(payload), 'text/event-stream')
  assert.equal(result.toString(), 'hello voice')
})
