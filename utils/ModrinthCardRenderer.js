import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import ModrinthCard from "../model/ModrinthCard.js"

export async function prewarmModrinthCardRenderer() {
  if (typeof puppeteer?.browserInit !== "function") return true
  const browser = await puppeteer.browserInit()
  if (!browser) throw new Error("Chromium 渲染器未就绪")
  return true
}

export async function renderModrinthCard(e, card = {}) {
  const data = await new ModrinthCard(e).getData({
    ...(card.view || {}),
    projectId: card.projectId || card.view?.projectId || ""
  }, 1)
  return await puppeteer.screenshot("modrinthCard", data, 2)
}
