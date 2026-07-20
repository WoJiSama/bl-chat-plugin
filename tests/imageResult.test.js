import { test } from "node:test"
import assert from "node:assert/strict"
import { extractImageResult } from "../utils/imageResult.js"

test("keeps normalized base64 image results", () => {
  assert.equal(extractImageResult("base64://aW1hZ2U="), "base64://aW1hZ2U=")
})

test("normalizes data URI and markdown image results", () => {
  assert.equal(extractImageResult("data:image/png;base64,aW1hZ2U="), "base64://aW1hZ2U=")
  assert.equal(extractImageResult("![result](https://example.com/a.png)"), "https://example.com/a.png")
})

test("keeps direct image URLs including query strings", () => {
  assert.equal(extractImageResult("https://example.com/a.jpeg?token=1"), "https://example.com/a.jpeg?token=1")
})
