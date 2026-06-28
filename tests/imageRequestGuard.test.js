import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMissingImageAnalysisReply,
  looksLikeImageAuthenticityRequest,
  looksLikeImageVerificationRequest,
  looksLikeVisualInspectionRequest
} from '../utils/imageRequestGuard.js'

test('detects visual inspection requests without explicit image word', () => {
  assert.equal(looksLikeVisualInspectionRequest('@这里是希洛! 看看腿'), true)
  assert.equal(looksLikeVisualInspectionRequest('帮我看看这个细节'), true)
})

test('does not treat non-visual body advice as image inspection', () => {
  assert.equal(looksLikeVisualInspectionRequest('看看腿疼怎么办'), false)
  assert.equal(looksLikeVisualInspectionRequest('帮我看看腿怎么练'), false)
})

test('detects image-grounded verification and latest-info requests', () => {
  assert.equal(looksLikeImageVerificationRequest('希洛，查一下这个是真的假的，看看现在最新的信息'), true)
  assert.equal(looksLikeImageVerificationRequest('帮我核实一下这张截图是不是真的'), true)
  assert.equal(looksLikeImageVerificationRequest('这图是不是AI生成的'), true)
})

test('does not treat unrelated realtime lookup as image verification', () => {
  assert.equal(looksLikeImageVerificationRequest('查一下今天深圳天气'), false)
  assert.equal(looksLikeImageVerificationRequest('最新版本是多少'), false)
})

test('separates content verification from image authenticity', () => {
  assert.equal(looksLikeImageAuthenticityRequest('希洛，查一下这个是真的假的，看看现在最新的信息'), false)
  assert.equal(looksLikeImageAuthenticityRequest('这张图是不是AI生成的'), true)
  assert.equal(looksLikeImageAuthenticityRequest('这张图片是不是P的'), true)
})

test('missing image reply asks for image warmly', () => {
  const reply = buildMissingImageAnalysisReply()
  assert.ok(reply.includes('没看到图'))
  assert.ok(reply.includes('发一下') || reply.includes('引用'))
  assert.ok(!reply.includes('真没有'))
})
