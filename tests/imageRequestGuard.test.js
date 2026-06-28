import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMissingImageAnalysisReply, looksLikeVisualInspectionRequest } from '../utils/imageRequestGuard.js'

test('detects visual inspection requests without explicit image word', () => {
  assert.equal(looksLikeVisualInspectionRequest('@这里是希洛! 看看腿'), true)
  assert.equal(looksLikeVisualInspectionRequest('帮我看看这个细节'), true)
})

test('does not treat non-visual body advice as image inspection', () => {
  assert.equal(looksLikeVisualInspectionRequest('看看腿疼怎么办'), false)
  assert.equal(looksLikeVisualInspectionRequest('帮我看看腿怎么练'), false)
})

test('missing image reply asks for image warmly', () => {
  const reply = buildMissingImageAnalysisReply()
  assert.ok(reply.includes('没看到图'))
  assert.ok(reply.includes('发一下') || reply.includes('引用'))
  assert.ok(!reply.includes('真没有'))
})
