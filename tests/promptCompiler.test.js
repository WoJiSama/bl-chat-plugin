import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileImagePrompt } from '../utils/promptCompiler.js'

test('expands a normal text-to-image request into structured visual intent', () => {
  const prompt = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '画一个雨夜里的赛博少女，孤独一点'
  })

  assert.ok(prompt.includes('任务：文生图'))
  assert.ok(prompt.includes('雨夜里的赛博少女'))
  assert.ok(prompt.includes('孤独'))
  assert.ok(prompt.includes('夜景光影'))
  assert.ok(prompt.includes('构图'))
  assert.ok(!prompt.includes('模型'))
  assert.ok(!prompt.includes('示例'))
  assert.ok(!/敏感|露骨/.test(prompt))
})

test('uses quoted context when the user says draw this', () => {
  const prompt = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '画这个',
    quotedContext: 'A说：今晚一起去看烟花吧。B脸红着说：才不是想和你一起去呢。'
  })

  assert.ok(prompt.includes('以引用内容中的人物、事件、关系和场景为主体'))
  assert.ok(prompt.includes('引用/回复内容'))
  assert.ok(prompt.includes('烟花'))
  assert.ok(prompt.includes('不要把“这个/这张/上面”当成无意义词丢掉'))
})

test('keeps reference image identity for image edit requests', () => {
  const prompt = compileImagePrompt({
    task: 'image_edit',
    userPrompt: '把她改可爱点',
    hasReferenceImages: true
  })

  assert.ok(prompt.includes('任务：图像编辑'))
  assert.ok(prompt.includes('必须保留'))
  assert.ok(prompt.includes('参考图里的主要人物'))
  assert.ok(prompt.includes('只修改'))
  assert.ok(prompt.includes('不要重新生成无关新图'))
})

test('keeps comic structure grounded in context', () => {
  const prompt = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '根据这个画成四格漫画',
    quotedContext: '第一句：我迟到了。第二句：没关系，我也刚到。'
  })

  assert.ok(prompt.includes('连环画/分镜要求'))
  assert.ok(prompt.includes('剧情必须来自用户给出的内容'))
  assert.ok(prompt.includes('不要胡编无关桥段'))
})

test('does not pollute explicit new image requests with recent context', () => {
  const prompt = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '画一只白色小猫在窗台晒太阳',
    recentContext: '刚才大家在讨论赛博少女、雨夜霓虹、黑色机甲和末日废墟'
  })

  assert.ok(prompt.includes('白色小猫'))
  assert.ok(prompt.includes('按用户原话生成画面'))
  assert.ok(!prompt.includes('赛博少女'))
  assert.ok(!prompt.includes('末日废墟'))
  assert.ok(!prompt.includes('近期相关上下文'))
})

test('uses recent context only when the request is contextual or vague', () => {
  const prompt = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '继续按刚才那个风格再画一张',
    recentContext: '刚才确定的风格是雨夜霓虹、赛博城市、孤独少女'
  })

  assert.ok(prompt.includes('近期相关上下文'))
  assert.ok(prompt.includes('雨夜霓虹'))
  assert.ok(prompt.includes('赛博城市'))
})

test('does not wrap an already compiled prompt again', () => {
  const first = compileImagePrompt({
    task: 'image_generation',
    userPrompt: '画一只白色小猫在窗台晒太阳'
  })
  const second = compileImagePrompt({
    task: 'image_generation',
    userPrompt: first,
    recentContext: '刚才讨论的是赛博少女'
  })

  assert.equal(second, first)
  assert.equal(second.match(/【提示词编译结果】/g)?.length, 1)
  assert.ok(!second.includes('核心画面：【提示词编译结果】'))
})
