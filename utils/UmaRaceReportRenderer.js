import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import UmaRaceReport from "../model/UmaRaceReport.js"

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildRankRows(rows = []) {
  return rows.map(row => `
    <tr>
      <td class="rank">#${escapeHtml(row.rank)}</td>
      <td>
        <div class="runner">${escapeHtml(row.name)}</div>
        <div class="meta">${escapeHtml(row.meta || "")}</div>
      </td>
      <td><span class="tag">${escapeHtml(row.strategy || "-")}</span></td>
      <td class="state">${escapeHtml(row.state || "")}</td>
    </tr>
  `).join("")
}

function buildHighlightRows(lines = []) {
  return lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")
}

function buildAwardRows(lines = []) {
  return lines.map(line => `<span class="award">${escapeHtml(line)}</span>`).join("")
}

export function buildUmaRaceReportView(report = {}) {
  return {
    typeClass: escapeHtml(report.type || "stage"),
    title: escapeHtml(report.title || "赛马娘比赛"),
    subtitle: escapeHtml(report.subtitle || ""),
    scene: escapeHtml(report.scene || ""),
    generatedAt: escapeHtml(report.generatedAt || ""),
    prompt: escapeHtml(report.prompt || ""),
    rankRowsHtml: buildRankRows(report.ranking || []),
    highlightsHtml: buildHighlightRows(report.highlights || []),
    awardsHtml: buildAwardRows(report.awards || []),
    hasAwardsClass: report.awards?.length ? "has-awards" : "no-awards"
  }
}

export async function renderUmaRaceReport(e, report) {
  const view = buildUmaRaceReportView(report)
  const data = await new UmaRaceReport(e).getData(view, 1)
  return puppeteer.screenshot("umaRaceReport", data, 2)
}
