import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateImageWithFallbacks,
  resolveImageGenerationConfigs,
  shouldRetryWithoutUrlResponseFormat,
  toImageGenerationUrl
} from '../utils/imageGenerationFallback.js'

function response(ok, body, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    async text() {
      return JSON.stringify(body)
    }
  }
}

test('keeps legacy imageGenerationAiConfig as first candidate and appends fallbacks', () => {
  const configs = resolveImageGenerationConfigs({
    imageGenerationAiConfig: {
      imageGenerationApiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      imageGenerationApiModel: 'doubao-seedream-5-0-260128',
      imageGenerationApiKey: 'seedream-key',
      imageGenerationSize: '2K',
      imageGenerationPriority: 1,
      imageGenerationFallbacks: [
        {
          name: 'image2',
          imageGenerationApiUrl: 'https://api.openai.com/v1',
          imageGenerationApiModel: 'gpt-image-2',
          imageGenerationApiKey: 'image2-key',
          imageGenerationSize: '1024x1024',
          priority: 2
        }
      ]
    }
  })

  assert.equal(configs.length, 2)
  assert.deepEqual(
    configs.map(item => [item.name, item.apiUrl, item.model, item.size]),
    [
      ['doubao-seedream-5-0-260128', 'https://ark.cn-beijing.volces.com/api/v3/images/generations', 'doubao-seedream-5-0-260128', '2K'],
      ['image2', 'https://api.openai.com/v1/images/generations', 'gpt-image-2', '1024x1024']
    ]
  )
})

test('supports explicit ordered imageGenerationProviders list', () => {
  const configs = resolveImageGenerationConfigs({
    imageGenerationAiConfig: {
      imageGenerationApiUrl: 'https://primary.example.com/v1/images/generations',
      imageGenerationApiModel: 'primary-image',
      imageGenerationApiKey: 'primary-key',
      imageGenerationPriority: 3,
      imageGenerationProviders: [
        {
          name: 'seedream',
          imageGenerationApiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
          imageGenerationApiModel: 'doubao-seedream-5-0-260128',
          imageGenerationApiKey: 'seedream-key',
          imageGenerationSize: '2K',
          priority: 1
        },
        {
          name: 'image2',
          apiUrl: 'https://api.openai.com/v1/images/edits',
          model: 'gpt-image-2',
          apiKey: 'image2-key',
          size: '1024x1024',
          priority: 2
        }
      ]
    }
  })

  assert.equal(configs.length, 3)
  assert.equal(configs[0].name, 'seedream')
  assert.equal(configs[1].name, 'image2')
  assert.equal(configs[2].name, 'primary-image')
  assert.equal(configs[1].apiUrl, 'https://api.openai.com/v1/images/generations')
})

test('supports Guoba providers-only configuration', () => {
  const configs = resolveImageGenerationConfigs({
    imageGenerationAiConfig: {
      providers: [
        {
          name: 'doubao',
          apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
          model: 'doubao-seedream-5-0-260128',
          apiKey: 'seedream-key',
          size: '2K',
          priority: 2
        },
        {
          name: 'image2',
          apiUrl: 'https://api.openai.com/v1/images/generations',
          model: 'gpt-image-2',
          apiKey: 'image2-key',
          size: '1024x1024',
          priority: 1
        }
      ]
    }
  })

  assert.deepEqual(configs.map(item => item.name), ['image2', 'doubao'])
})

test('priority can promote any configured provider to first place', () => {
  const configs = resolveImageGenerationConfigs({
    imageGenerationAiConfig: {
      imageGenerationApiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      imageGenerationApiModel: 'doubao-seedream-5-0-260128',
      imageGenerationApiKey: 'seedream-key',
      imageGenerationSize: '2K',
      imageGenerationPriority: 2,
      imageGenerationProviders: [
        {
          name: 'image2',
          imageGenerationApiUrl: 'https://api.openai.com/v1/images/generations',
          imageGenerationApiModel: 'gpt-image-2',
          imageGenerationApiKey: 'image2-key',
          imageGenerationSize: '1024x1024',
          priority: 1
        }
      ]
    }
  })

  assert.equal(configs[0].name, 'image2')
  assert.equal(configs[1].name, 'doubao-seedream-5-0-260128')
})

test('skips placeholder keys and falls back to imageEditAiConfig only for generation-like edit config', () => {
  assert.deepEqual(resolveImageGenerationConfigs({
    imageGenerationAiConfig: {
      imageGenerationApiUrl: 'https://api.openai.com/v1/images/generations',
      imageGenerationApiModel: 'gpt-image-1',
      imageGenerationApiKey: 'sk-xxxxx'
    }
  }), [])

  const configs = resolveImageGenerationConfigs({
    imageEditAiConfig: {
      imageEditApiUrl: 'https://api.openai.com/v1/images/edits',
      imageEditApiModel: 'gpt-image-1',
      imageEditApiKey: 'real-key'
    }
  })

  assert.equal(configs.length, 1)
  assert.equal(configs[0].apiUrl, 'https://api.openai.com/v1/images/generations')
  assert.equal(configs[0].model, 'gpt-image-1')
})

test('normalizes common endpoint URLs to images/generations', () => {
  assert.equal(toImageGenerationUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/images/generations')
  assert.equal(toImageGenerationUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/images/generations')
  assert.equal(toImageGenerationUrl('https://api.openai.com/v1/images/edits'), 'https://api.openai.com/v1/images/generations')
})

test('falls back to second model when first model fails', async () => {
  const calls = []
  const image = await generateImageWithFallbacks([
    { name: 'seedream', apiUrl: 'u1', model: 'm1', apiKey: 'key-1', size: '2K' },
    { name: 'image2', apiUrl: 'u2', model: 'm2', apiKey: 'key-2', size: '1024x1024' }
  ], '画一只猫', {
    async request(config, prompt, responseFormat) {
      calls.push([config.name, prompt, responseFormat || 'default'])
      return config.name === 'seedream'
        ? response(false, { error: { message: 'rate limited' } }, 429)
        : response(true, { data: [{ url: 'https://example.com/cat.png' }] })
    },
    async parseResponse(res) {
      const data = JSON.parse(await res.text())
      if (!res.ok) return { ok: false, errorMessage: data.error.message }
      return { ok: true, image: data.data[0].url }
    }
  })

  assert.equal(image, 'https://example.com/cat.png')
  assert.deepEqual(calls.map(item => [item[0], item[2]]), [
    ['seedream', 'url'],
    ['image2', 'url']
  ])
})

test('retries same model without response_format before moving to next fallback', async () => {
  const calls = []
  const image = await generateImageWithFallbacks([
    { name: 'seedream', apiUrl: 'u1', model: 'm1', apiKey: 'key-1', size: '2K' },
    { name: 'image2', apiUrl: 'u2', model: 'm2', apiKey: 'key-2', size: '1024x1024' }
  ], '画一只猫', {
    async request(config, prompt, responseFormat) {
      calls.push([config.name, responseFormat || 'default'])
      if (responseFormat === 'url') {
        return response(false, { error: { message: 'unknown parameter: response_format' } }, 400)
      }
      return response(true, { data: [{ b64_json: 'abc123' }] })
    },
    async parseResponse(res) {
      const data = JSON.parse(await res.text())
      if (!res.ok) return { ok: false, errorMessage: data.error.message }
      const item = data.data[0]
      return { ok: true, image: item.url || `base64://${item.b64_json}` }
    }
  })

  assert.equal(image, 'base64://abc123')
  assert.deepEqual(calls, [
    ['seedream', 'url'],
    ['seedream', 'default']
  ])
})

test('final failure message contains provider labels but not api keys', async () => {
  await assert.rejects(
    () => generateImageWithFallbacks([
      { name: 'seedream', apiUrl: 'u1', model: 'm1', apiKey: 'secret-key-1', size: '2K' },
      { name: 'image2', apiUrl: 'u2', model: 'm2', apiKey: 'secret-key-2', size: '1024x1024' }
    ], '画一只猫', {
      async request(config) {
        throw new Error(`${config.name} unavailable`)
      },
      async parseResponse() {
        throw new Error('should not parse')
      }
    }),
    error => {
      assert.match(error.message, /seedream/)
      assert.match(error.message, /image2/)
      assert.doesNotMatch(error.message, /secret-key/)
      return true
    }
  )
})

test('detects response_format compatibility errors', () => {
  assert.equal(shouldRetryWithoutUrlResponseFormat('unknown parameter: response_format'), true)
  assert.equal(shouldRetryWithoutUrlResponseFormat('service unavailable'), false)
})
