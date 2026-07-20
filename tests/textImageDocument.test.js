import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('code and markdown default to document card rendering', async (t) => {
  let shouldUseDocumentTemplateForTextImage
  try {
    shouldUseDocumentTemplateForTextImage = (await import('../functions/functions_tools/TextImageTool.js')).shouldUseDocumentTemplateForTextImage
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('render dependencies are not installed in this checkout')
      return
    }
    throw error
  }

  assert.equal(shouldUseDocumentTemplateForTextImage('```js\nconst a = 1\nconsole.log(a)\n```'), true)
  assert.equal(shouldUseDocumentTemplateForTextImage('## 标题\n\n- 第一项\n- 第二项\n- 第三项'), true)
  assert.equal(shouldUseDocumentTemplateForTextImage('好呀，我在。'), false)
})

test('document template renders a readable html screenshot', async (t) => {
  let sharp
  let TextImageTool
  try {
    sharp = (await import('sharp')).default
    TextImageTool = (await import('../functions/functions_tools/TextImageTool.js')).TextImageTool
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('render dependencies are not installed in this checkout')
      return
    }
    throw error
  }

  const tool = new TextImageTool()
  let imagePath
  try {
    imagePath = await tool.renderDocumentImage({
      text: [
        '# 处理建议',
        '',
        '这个报错主要是 Java 版本和 Maven 插件版本不匹配。',
        '',
        '- 先确认本机 JDK 版本',
        '- 再刷新 Maven 依赖',
        '',
        '```js',
        'const version = process.version',
        'console.log(version)',
        '```'
      ].join('\n')
    })
  } catch (error) {
    if (/Could not find Chrome|Chromium|executable/i.test(error?.message || '')) {
      t.skip('Chromium is not available in this checkout')
      return
    }
    throw error
  }

  try {
    const metadata = await sharp(imagePath).metadata()
    assert.ok(metadata.width >= 900, `document width too small: ${metadata.width}`)
    assert.ok(metadata.height >= 500, `document height too small: ${metadata.height}`)
    assert.equal(metadata.format, 'png')
  } finally {
    await fs.unlink(imagePath).catch(() => {})
  }
})
