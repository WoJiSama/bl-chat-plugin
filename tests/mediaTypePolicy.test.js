import test from "node:test"
import assert from "node:assert/strict"
import { classifyMessageSegmentMedia, getMessageFileName } from "../utils/mediaTypePolicy.js"

test("never treats Excel and document file segments as images", () => {
  assert.equal(classifyMessageSegmentMedia({ type: "file", file: "人物卡.xlsx", url: "https://example.com/download?fname=" }), "non_image_file")
  assert.equal(classifyMessageSegmentMedia({ type: "file", data: { name: "报告.pdf", url: "https://example.com/file" } }), "non_image_file")
})
test("keeps real images sent through the file segment path", () => {
  assert.equal(classifyMessageSegmentMedia({ type: "file", name: "原图.PNG", url: "https://example.com/file" }), "image_file")
  assert.equal(classifyMessageSegmentMedia({ type: "image", url: "https://example.com/no-extension" }), "image")
  assert.equal(getMessageFileName({ type: "file", data: { file_name: "图.jpg" } }), "图.jpg")
})

test("requires content verification for extensionless file segments", () => {
  assert.equal(classifyMessageSegmentMedia({ type: "file", url: "https://example.com/download?fname=" }), "unknown_file")
})
