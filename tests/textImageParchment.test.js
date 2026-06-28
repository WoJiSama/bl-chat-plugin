import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

function isParchmentPixel(r, g, b) {
  return r > 145 && g > 95 && b > 45 && r > b + 55 && g > b + 25
}

async function parchmentRatioOnColumn(raw, width, height, x) {
  let hits = 0
  const step = Math.max(1, Math.floor(height / 80))
  let total = 0
  for (let y = 0; y < height; y += step) {
    const index = (y * width + x) * 4
    if (isParchmentPixel(raw[index], raw[index + 1], raw[index + 2])) hits++
    total++
  }
  return hits / total
}

test('parchment paper fills image close to left and right edges', async (t) => {
  let sharp
  let TextImageTool
  try {
    sharp = (await import('sharp')).default
    TextImageTool = (await import('../functions/functions_tools/TextImageTool.js')).TextImageTool
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('sharp is not installed in this checkout')
      return
    }
    throw error
  }

  const tool = new TextImageTool()
  const imagePath = await tool.renderParchmentImage({
    text: '这个报错主要是 Java 版本和 Maven 插件版本不匹配。先把 JDK 升到 17 或 21，再重新刷新 Maven；如果暂时不能升级，就把 spring-boot-maven-plugin 降到兼容 JDK8 的版本。',
    variantName: 'medium'
  })

  try {
    const image = sharp(imagePath).ensureAlpha()
    const metadata = await image.metadata()
    const raw = await image.raw().toBuffer()
    const leftRatio = await parchmentRatioOnColumn(raw, metadata.width, metadata.height, 18)
    const rightRatio = await parchmentRatioOnColumn(raw, metadata.width, metadata.height, metadata.width - 19)

    assert.ok(leftRatio > 0.45, `left edge parchment ratio too low: ${leftRatio}`)
    assert.ok(rightRatio > 0.35, `right edge parchment ratio too low: ${rightRatio}`)
  } finally {
    await fs.unlink(imagePath).catch(() => {})
  }
})
