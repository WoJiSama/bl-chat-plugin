import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripChatLogSpeakerPrefix, stripChatLogSpeakerPrefixes } from '../utils/replySanitizer.js'

test('strips copied chat-log prefix and keeps reply text', () => {
  const input = '[2026-06-23 19:00:43] 某机器人(QQ号:3094088525): 啊？可视化...你现在让我变个进度条出来吗？'
  assert.equal(
    stripChatLogSpeakerPrefix(input),
    '啊？可视化...你现在让我变个进度条出来吗？'
  )
})

test('strips group-role history prefix with 在群里说', () => {
  const input = '[2026-06-23 19:00:43] 小明(qq号: 123456)[群身份: member]: 在群里说: 我看一下进度。'
  assert.equal(stripChatLogSpeakerPrefix(input), '我看一下进度。')
})

test('strips unbracketed history prefix', () => {
  const input = '2026-06-23 19:00:43 小明(QQ:123456): 先等我看一下。'
  assert.equal(stripChatLogSpeakerPrefix(input), '先等我看一下。')
})

test('strips prefixes per line without touching normal text', () => {
  const input = [
    '[19:00:43] 小明(QQ号:123456): 第一行',
    '普通说明：[2026-06-23 19:00:43] 这只是文字'
  ].join('\n')
  assert.equal(
    stripChatLogSpeakerPrefixes(input),
    ['第一行', '普通说明：[2026-06-23 19:00:43] 这只是文字'].join('\n')
  )
})
