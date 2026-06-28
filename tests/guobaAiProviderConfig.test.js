import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_PROVIDER_DEFINITIONS,
  normalizeAiProviderUpdates,
  withAiProviderPanelDefaults
} from '../utils/guobaAiProviderConfig.js'

test('Guoba AI model panel exposes provider lists for every AI config', async () => {
  const { default: aiModels } = await import('../models/Guoba/schemas/aiModels.js')
  const fields = aiModels.map(item => item.field).filter(Boolean)

  for (const definition of AI_PROVIDER_DEFINITIONS) {
    assert.ok(fields.includes(`${definition.configKey}.providers`), `${definition.configKey} providers missing`)
    assert.ok(!fields.includes(`${definition.configKey}.${definition.urlField}`), `${definition.configKey} legacy url should be hidden`)
    assert.ok(!fields.includes(`${definition.configKey}.${definition.modelField}`), `${definition.configKey} legacy model should be hidden`)
    assert.ok(!fields.includes(`${definition.configKey}.${definition.keyField}`), `${definition.configKey} legacy key should be hidden`)
  }
})

test('Guoba getConfigData converts legacy AI config fields into provider lists', () => {
  const settings = withAiProviderPanelDefaults({
    chatAiConfig: {
      chatApiUrl: 'https://api.example.com/v1/chat/completions',
      chatApiModel: 'chat-primary',
      chatApiKey: 'chat-key',
      chatAiPriority: 2
    },
    imageGenerationAiConfig: {
      imageGenerationApiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      imageGenerationApiModel: 'doubao-seedream-5-0-260128',
      imageGenerationApiKey: 'seedream-key',
      imageGenerationSize: '2K',
      imageGenerationPriority: 1
    }
  })

  assert.deepEqual(settings.chatAiConfig.providers, [
    {
      name: 'chat-primary',
      apiUrl: 'https://api.example.com/v1/chat/completions',
      model: 'chat-primary',
      apiKey: 'chat-key',
      priority: 2
    }
  ])
  assert.deepEqual(settings.imageGenerationAiConfig.providers, [
    {
      name: 'doubao-seedream-5-0-260128',
      apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      model: 'doubao-seedream-5-0-260128',
      apiKey: 'seedream-key',
      size: '2K',
      priority: 1
    }
  ])
})

test('Guoba save updates sync first-priority provider back to each legacy config', () => {
  const updates = normalizeAiProviderUpdates({
    'chatAiConfig.providers': [
      {
        name: 'slow-chat',
        apiUrl: 'https://slow.example.com/v1/chat/completions',
        model: 'slow-model',
        apiKey: 'slow-key',
        priority: 2
      },
      {
        name: 'fast-chat',
        apiUrl: 'https://fast.example.com/v1/chat/completions',
        model: 'fast-model',
        apiKey: 'fast-key',
        priority: 1
      }
    ],
    'imageGenerationAiConfig.providers': [
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
  })

  assert.equal(updates['chatAiConfig.name'], 'fast-chat')
  assert.equal(updates['chatAiConfig.chatApiUrl'], 'https://fast.example.com/v1/chat/completions')
  assert.equal(updates['chatAiConfig.chatApiModel'], 'fast-model')
  assert.equal(updates['chatAiConfig.chatApiKey'], 'fast-key')
  assert.equal(updates['chatAiConfig.chatAiPriority'], 1)

  assert.equal(updates['imageGenerationAiConfig.name'], 'image2')
  assert.equal(updates['imageGenerationAiConfig.imageGenerationApiModel'], 'gpt-image-2')
  assert.equal(updates['imageGenerationAiConfig.imageGenerationSize'], '1024x1024')
  assert.equal(updates['imageGenerationAiConfig.imageGenerationPriority'], 1)
})
