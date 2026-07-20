import { test } from "node:test"
import assert from "node:assert/strict"
import {
  safeTruncateUnicode,
  sanitizeJsonValue,
  sanitizeMessagesForJson,
  sanitizeUnicodeText,
  splitUnicodeText
} from "../utils/unicodeText.js"

const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u

test("unicode truncation keeps an emoji intact at the boundary", () => {
  const input = `${"a".repeat(179)}😋后续`
  const output = safeTruncateUnicode(input, 180)

  assert.equal(output, `${"a".repeat(179)}😋`)
  assert.doesNotMatch(output, LONE_SURROGATE_RE)
})

test("unicode sanitizer replaces isolated high and low surrogates", () => {
  const input = `前${String.fromCharCode(0xD83D)}中${String.fromCharCode(0xDC4D)}后`
  const output = sanitizeUnicodeText(input)

  assert.equal(output, "前�中�后")
  assert.doesNotMatch(output, LONE_SURROGATE_RE)
})

test("API message sanitization removes invalid surrogates recursively", () => {
  const broken = String.fromCharCode(0xD83D)
  const messages = sanitizeMessagesForJson([
    { role: "system", content: `近期消息${broken}`, metadata: { note: broken } },
    { role: "user", content: [{ type: "text", text: `你好${broken}` }] }
  ])
  const body = JSON.stringify(sanitizeJsonValue({ model: "test", messages }))

  assert.doesNotMatch(body, /\\ud83d|\\udc00/i)
  assert.deepEqual(JSON.parse(body), { model: "test", messages })
})

test("unicode chunking never splits an emoji between messages", () => {
  const chunks = splitUnicodeText(`1234😋5678`, 5)

  assert.deepEqual(chunks, ["1234😋", "5678"])
  for (const chunk of chunks) assert.doesNotMatch(chunk, LONE_SURROGATE_RE)
})
