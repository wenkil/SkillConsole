import type { StructuredTestReportV1 } from "./test-report.domain.js"
import {
  renderTestReportAnalysisHtmlFragment,
  type RenderableTestReportAnalysis,
  testReportAnalysisDocumentStyles,
  testReportAnalysisRendererVersion,
} from "./test-report-analysis-renderer.js"
import {
  renderTestReportHtmlFragment,
  type TestReportDocumentLocale,
  testReportDocumentRendererVersion,
  testReportDocumentStyles,
} from "./test-report-renderer.js"

export const testReportCombinedRendererVersion =
  "test-report-combined-renderer-v1"

const copy = {
  en: {
    title: "Complete test report",
    analysisPart: "Part 2 · AI analysis",
    analysisNotice:
      "The analysis below is model-generated interpretation. The deterministic fact report above remains the source of truth.",
  },
  "zh-CN": {
    title: "完整测试报告",
    analysisPart: "第二部分 · AI 分析",
    analysisNotice:
      "以下内容是模型生成的解释层；上方确定性事实报告仍是测试事实来源。",
  },
} as const

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function getCombinedTestReportDocumentFilename(
  analysis: RenderableTestReportAnalysis,
  report: StructuredTestReportV1,
): string {
  const prefix =
    report.reportType === "skill_effect" ? "skill-effect" : "version-comparison"
  return `${prefix}-${report.runId.slice(0, 8)}-r${report.reportRevisionNumber}-a${analysis.revisionNumber}-full.html`
}

export function renderCombinedTestReportHtml(
  analysis: RenderableTestReportAnalysis,
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${testReportCombinedRendererVersion}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(report.title)} · ${escapeHtml(t.title)}</title>
<style>
${testReportAnalysisDocumentStyles}
${testReportDocumentStyles}
.combined-analysis-break{margin-top:64px;padding-top:28px;border-top:5px double var(--ink);break-before:page;page-break-before:always}.combined-analysis-break>h1{margin:0;font-size:26px}.combined-analysis-break>.combined-analysis-notice{margin:10px 0 24px;border-left:4px solid var(--accent);background:var(--raised);padding:12px 14px}.analysis-document section{margin-top:26px;break-inside:auto}.analysis-document .hero,.analysis-document .finding,.analysis-document .panel{border:1px solid var(--rule);background:var(--raised);padding:20px}.analysis-document .hero{border-color:var(--ink)}.analysis-document .hero h1{font-size:clamp(32px,5vw,52px);line-height:1;margin:12px 0;letter-spacing:normal}.analysis-document .eyebrow{font-family:Consolas,monospace;color:var(--accent);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.analysis-document .notice{border-left:4px solid var(--accent);padding:12px 14px;background:var(--paper)}.analysis-document .meta{display:flex;flex-wrap:wrap;gap:7px 18px;color:var(--muted);font:11px Consolas,monospace}.analysis-document .finding{break-inside:avoid}@media(max-width:650px){.combined-analysis-break{margin-top:40px;padding-top:20px}}@media print{.combined-analysis-break{margin-top:0}.analysis-document section{break-inside:auto}}
</style>
</head>
<body><main>
${renderTestReportHtmlFragment(report, locale)}
<div class="combined-analysis-break"><h1>${escapeHtml(t.analysisPart)}</h1><p class="combined-analysis-notice">${escapeHtml(t.analysisNotice)}</p></div>
${renderTestReportAnalysisHtmlFragment(analysis, report, locale)}
<footer class="footer">${testReportCombinedRendererVersion} · ${testReportDocumentRendererVersion} · ${testReportAnalysisRendererVersion} · REPORT R${report.reportRevisionNumber} · ANALYSIS A${analysis.revisionNumber}</footer>
</main></body></html>`
}
