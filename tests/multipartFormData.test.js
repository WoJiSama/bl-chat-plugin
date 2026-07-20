import { test } from "node:test"
import assert from "node:assert/strict"
import { serializeMultipartFormData } from "../utils/multipartFormData.js"

test("serializes multipart form with an explicit complete body length", async () => {
  const form = new FormData()
  form.append("model", "image-model")
  form.append("prompt", "画一张图")
  form.append("image", new Blob([Buffer.from("image-bytes")], { type: "image/png" }), "reference.png")

  const multipart = await serializeMultipartFormData(form)
  const boundary = multipart.headers["Content-Type"].match(/boundary=(.+)$/)?.[1]

  assert.ok(boundary)
  assert.equal(Number(multipart.headers["Content-Length"]), multipart.body.length)
  assert.ok(multipart.body.includes(Buffer.from('name="prompt"')))
  assert.ok(multipart.body.includes(Buffer.from('filename="reference.png"')))
  assert.ok(multipart.body.toString().endsWith(`--${boundary}--\r\n`))
})

test("keeps every image part when serializing multiple references", async () => {
  const form = new FormData()
  form.append("prompt", "把两张参考图画成合照")
  form.append("image", new Blob([Buffer.from("first")], { type: "image/png" }), "first.png")
  form.append("image", new Blob([Buffer.from("second")], { type: "image/jpeg" }), "second.jpg")

  const { body, headers } = await serializeMultipartFormData(form)
  const text = body.toString()

  assert.equal(Number(headers["Content-Length"]), body.length)
  assert.ok(text.includes('filename="first.png"'))
  assert.ok(text.includes('filename="second.jpg"'))
  assert.ok(body.includes(Buffer.from("把两张参考图画成合照")))
})

test("supports standard form-data style buffered multipart bodies", async () => {
  const boundary = "----------------test-boundary"
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n画图\r\n--${boundary}--\r\n`)
  const form = {
    getHeaders: () => ({ "content-type": `multipart/form-data; boundary=${boundary}` }),
    getBuffer: () => body
  }

  const multipart = await serializeMultipartFormData(form)
  assert.equal(multipart.body, body)
  assert.equal(multipart.headers["Content-Type"], `multipart/form-data; boundary=${boundary}`)
  assert.equal(multipart.headers["Content-Length"], String(body.length))
})
