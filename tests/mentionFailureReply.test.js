import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMentionMembersFailureReply } from '../utils/mentionFailureReply.js'

test('missing mention target is explained naturally instead of blaming the answer service', () => {
  const reply = buildMentionMembersFailureReply('error: 当前群未找到要艾特的成员: 绘梨衣的星怒')
  assert.match(reply, /没对上“绘梨衣的星怒”这个名字/)
  assert.match(reply, /直接 @对方一下/)
  assert.doesNotMatch(reply, /回答服务|请求失败|问题我完整收到了/)
})

test('other mention failures remain truthful and do not claim a successful mention', () => {
  assert.match(buildMentionMembersFailureReply('error: 没有指定要艾特的成员'), /想喊谁/)
  assert.match(buildMentionMembersFailureReply('error: 当前适配器无法读取群成员'), /没拿到群成员列表/)
  assert.match(buildMentionMembersFailureReply('unexpected'), /没把人喊出来/)
})
