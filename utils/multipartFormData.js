export async function serializeMultipartFormData(formData) {
  if (typeof formData?.getHeaders === "function" && typeof formData?.getBuffer === "function") {
    const body = formData.getBuffer()
    if (!body.length) throw new Error("multipart 请求体为空")
    const sourceHeaders = formData.getHeaders()
    const contentType = sourceHeaders["content-type"] || sourceHeaders["Content-Type"] || ""
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
      throw new Error("无法生成 multipart boundary")
    }
    return {
      body,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.length)
      }
    }
  }

  const encoded = new Response(formData)
  const contentType = encoded.headers.get("content-type") || ""
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw new Error("无法生成 multipart boundary")
  }

  const body = Buffer.from(await encoded.arrayBuffer())
  if (!body.length) throw new Error("multipart 请求体为空")

  return {
    body,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length)
    }
  }
}
