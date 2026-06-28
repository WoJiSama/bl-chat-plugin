import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitParchmentReplyText } from '../utils/parchmentReply.js'

test('drops self-conscious filler tail from parchment reply', () => {
  const main = '图片里的报错核心是 Java 版本不匹配。spring-boot-maven-plugin 4.1.0 是按 JDK17 编译的，但当前环境还在用 JDK1.8，所以加载插件 class 时会失败。处理方式就是升级 JDK，或者把插件版本降到兼容 JDK8 的版本。'.repeat(2)
  const result = splitParchmentReplyText(`${main}...唔，我是不是说多了`)
  assert.equal(result.chatText, '')
  assert.ok(result.imageText.includes('图片里的报错核心'))
  assert.ok(!result.imageText.includes('说多了'))
})

test('keeps technical body intact when there is no chat tail', () => {
  const text = '先检查 Java 版本，再检查 Maven 插件版本。'.repeat(8)
  const result = splitParchmentReplyText(text)
  assert.equal(result.imageText, text)
  assert.equal(result.chatText, '')
})
