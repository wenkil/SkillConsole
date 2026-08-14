import type { StoredTestRunUsage } from "../../infrastructure/database/index.js"
import type {
  ReportEvidenceRef,
  StructuredTestReportV1,
} from "./test-report.domain.js"
import type { TestReportAnalysisV1 } from "./test-report-analysis-protocol.js"
import type { TestReportDocumentLocale } from "./test-report-renderer.js"

export const testReportAnalysisRendererVersion =
  "test-report-analysis-renderer-v1"

export interface RenderableTestReportAnalysis {
  readonly id: string
  readonly reportId: string
  readonly reportRevisionId: string
  readonly revisionNumber: number
  readonly configuredModelId: string
  readonly actualModelId: string | null
  readonly modelId: string
  readonly configurationFingerprint: string
  readonly semanticConfigurationFingerprint: string
  readonly runtimePolicy: {
    readonly schemaVersion: string
    readonly timeoutMs: number
  }
  readonly runtimePolicyFingerprint: string
  readonly promptVersion: string
  readonly inputFingerprint: string
  readonly analysis: TestReportAnalysisV1
  readonly usage: StoredTestRunUsage | null
  readonly createdAt: string
  readonly completedAt: string | null
}

const copy = {
  en: {
    title: "AI report analysis",
    modelNotice:
      "This is a model-generated interpretation of an immutable deterministic report. Verify every Finding against the linked evidence.",
    summary: "Summary",
    priorities: "Priority findings",
    limitations: "Limitations",
    evidence: "Open original evidence",
    suggestedAction: "Suggested next check",
    usage: "Analyzer usage",
    facts: "Fact",
    inference: "Inference",
    suggestion: "Suggestion",
    model: "Model",
    configuredModel: "Configured model",
    runtimePolicy: "Runtime policy",
    prompt: "Prompt protocol",
    tokens: "Tokens",
    cost: "Cost",
    duration: "Duration",
    reportRevision: "Source Report Revision",
    analysisRevision: "Analysis Revision",
  },
  "zh-CN": {
    title: "AI 报告分析",
    modelNotice:
      "这是模型对不可变确定性报告的解释，不是新的测试事实。每条 Finding 都应回到所链接的原始证据核查。",
    summary: "分析摘要",
    priorities: "优先问题",
    limitations: "分析限制",
    evidence: "打开原始证据",
    suggestedAction: "建议的下一步核查",
    usage: "Analyzer 用量",
    facts: "事实",
    inference: "推断",
    suggestion: "建议",
    model: "模型",
    configuredModel: "配置模型",
    runtimePolicy: "运行策略",
    prompt: "Prompt 协议",
    tokens: "Token",
    cost: "成本",
    duration: "耗时",
    reportRevision: "来源报告修订",
    analysisRevision: "分析修订",
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

function escapeMarkdown(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]{}()#+.!|\-])/gu, "\\$1")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
}

function runUrl(
  report: StructuredTestReportV1,
  evalRevisionCaseId: string | undefined,
): string {
  const reportCase = evalRevisionCaseId
    ? report.cases.find(
        (item) => item.evalRevisionCaseId === evalRevisionCaseId,
      )
    : null
  const root = `/workbenches/${encodeURIComponent(report.workspaceId)}/runs/${encodeURIComponent(report.runId)}`
  return reportCase ? `${root}?externalId=${reportCase.externalId}` : root
}

function evidenceEvalRevisionCaseId(
  report: StructuredTestReportV1,
  ref: ReportEvidenceRef,
  fallback: readonly string[],
): string | undefined {
  for (const reportCase of report.cases) {
    if (
      ref.caseId &&
      (reportCase.targetCaseId === ref.caseId ||
        reportCase.baselineCaseId === ref.caseId)
    ) {
      return reportCase.evalRevisionCaseId
    }
    if (
      ref.assertionResultId &&
      reportCase.assertionTransitions.some(
        (assertion) =>
          assertion.targetAssertionResultId === ref.assertionResultId ||
          assertion.baselineAssertionResultId === ref.assertionResultId,
      )
    ) {
      return reportCase.evalRevisionCaseId
    }
  }
  return fallback[0]
}

function evidenceLabel(ref: ReportEvidenceRef): string {
  const identity =
    ref.assertionResultId ??
    ref.artifactId ??
    ref.caseId ??
    (ref.sequence !== undefined ? `#${ref.sequence}` : ref.runId)
  return identity ? `${ref.kind} · ${identity.slice(0, 12)}` : ref.kind
}

function findingLabel(
  kind: TestReportAnalysisV1["findings"][number]["kind"],
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return kind === "FACT"
    ? t.facts
    : kind === "INFERENCE"
      ? t.inference
      : t.suggestion
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`
}

export function getTestReportAnalysisDocumentFilename(
  input: RenderableTestReportAnalysis,
  format: "html" | "markdown",
): string {
  return `test-report-analysis-${input.reportId.slice(0, 8)}-a${input.revisionNumber}.${format === "html" ? "html" : "md"}`
}

export const testReportAnalysisDocumentStyles = `:root{color-scheme:light;--ink:#191816;--muted:#6e675f;--paper:#f5f1e8;--raised:#fffdf7;--rule:#c8c0b4;--accent:#e86041;--fact:#28734f;--infer:#966414;--suggest:#315f91}*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font-family:Inter,"Segoe UI",sans-serif;font-size:16px;line-height:1.65}body{margin:0}main{width:min(1120px,calc(100% - 48px));margin:auto;padding:40px 0 80px}.hero,.finding,.panel{border:1px solid var(--rule);background:var(--raised);padding:22px}.hero{border-color:var(--ink);padding:32px}.eyebrow,code,dt,.finding header{font-family:Consolas,monospace}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.hero h1{font-size:clamp(32px,5vw,56px);line-height:1.04;margin:12px 0 18px;letter-spacing:-.045em}.notice{border-left:4px solid var(--accent);padding:14px 16px;background:var(--paper)}.meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font:12px/1.55 Consolas,monospace}.summary{font-size:18px;line-height:1.75}.findings{display:grid;gap:14px}.finding header{display:flex;flex-wrap:wrap;gap:8px}.finding header span,.finding header strong{border:1px solid var(--rule);padding:3px 8px;font-size:11px}.finding h2{font-size:21px;line-height:1.3;margin:16px 0 8px}.finding p{margin:0}.finding aside{background:var(--paper);margin-top:16px;padding:12px 14px}.finding footer{border-top:1px solid var(--rule);margin-top:16px;padding-top:14px}.evidence-list{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:9px 0 0;padding:0}.evidence-list a{display:block;border:1px solid var(--rule);padding:5px 8px;color:inherit;font-size:13px}.kind-FACT{border-left:5px solid var(--fact)}.kind-INFERENCE{border-left:5px solid var(--infer)}.kind-SUGGESTION{border-left:5px solid var(--suggest)}section{margin-top:34px}section>h1{border-bottom:2px solid var(--ink);padding-bottom:9px;font-size:24px;line-height:1.25}dl{margin:0}dl div{display:grid;grid-template-columns:150px 1fr;border-top:1px solid var(--rule);padding:9px 0}dt{font-size:11px;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}@media(max-width:650px){html{font-size:15px}main{width:calc(100% - 24px);padding-top:16px}.hero{padding:20px}.evidence-list{display:block}.evidence-list li+li{margin-top:8px}}`

export function renderTestReportAnalysisHtmlFragment(
  input: RenderableTestReportAnalysis,
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  const byId = new Map(input.analysis.findings.map((item) => [item.id, item]))
  const findings = input.analysis.priorityOrder
    .map((id) => byId.get(id))
    .filter((item): item is TestReportAnalysisV1["findings"][number] => Boolean(item))
    .map((item, index) => {
      const evidence = item.evidenceRefs
        .map((ref) => {
          const evidenceUrl = runUrl(
            report,
            evidenceEvalRevisionCaseId(
              report,
              ref,
              item.affectedEvalCaseIds,
            ),
          )
          return `<li><a target="_top" rel="noreferrer" href="${escapeHtml(evidenceUrl)}"><code>${escapeHtml(evidenceLabel(ref))}</code></a></li>`
        })
        .join("")
      return `<article class="finding kind-${escapeHtml(item.kind)}"><header><span>${index + 1}</span><strong>${escapeHtml(findingLabel(item.kind, locale))}</strong><span>${escapeHtml(item.scope)}</span><span>${escapeHtml(item.confidence)}</span></header><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.statement)}</p>${item.suggestedAction ? `<aside><b>${escapeHtml(t.suggestedAction)}</b><p>${escapeHtml(item.suggestedAction)}</p></aside>` : ""}<footer><strong>${escapeHtml(t.evidence)}</strong><ul class="evidence-list">${evidence}</ul></footer></article>`
    })
    .join("")
  const limitations = input.analysis.limitations.length
    ? `<ul>${input.analysis.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p>—</p>`
  const usage = input.usage
    ? `<dl><div><dt>${escapeHtml(t.tokens)}</dt><dd>${input.usage.inputTokens + input.usage.outputTokens}</dd></div><div><dt>${escapeHtml(t.cost)}</dt><dd>$${input.usage.totalCostUsd.toFixed(4)}</dd></div><div><dt>${escapeHtml(t.duration)}</dt><dd>${escapeHtml(formatDuration(input.usage.durationMs))}</dd></div></dl>`
    : `<p>—</p>`
  return `<div class="analysis-document"><header class="hero"><div class="eyebrow">${escapeHtml(t.title)}</div><h1>${escapeHtml(report.title)}</h1><p class="notice">${escapeHtml(t.modelNotice)}</p><div class="meta"><span>${escapeHtml(t.analysisRevision)} ${input.revisionNumber}</span><span>${escapeHtml(t.reportRevision)} ${report.reportRevisionNumber}</span><span>${escapeHtml(t.model)} ${escapeHtml(input.modelId)}</span><span>${escapeHtml(t.configuredModel)} ${escapeHtml(input.configuredModelId)}</span><span>${escapeHtml(t.prompt)} ${escapeHtml(input.promptVersion)}</span><span>${escapeHtml(t.runtimePolicy)} ${escapeHtml(input.runtimePolicy.schemaVersion)} · ${escapeHtml(formatDuration(input.runtimePolicy.timeoutMs))}</span></div></header><section><h1>${escapeHtml(t.summary)}</h1><div class="panel summary">${escapeHtml(input.analysis.summary)}</div></section><section><h1>${escapeHtml(t.priorities)}</h1><div class="findings">${findings || "—"}</div></section><section><h1>${escapeHtml(t.limitations)}</h1><div class="panel">${limitations}</div></section><section><h1>${escapeHtml(t.usage)}</h1><div class="panel">${usage}</div></section></div>`
}

export function renderTestReportAnalysisHtml(
  input: RenderableTestReportAnalysis,
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${testReportAnalysisRendererVersion}"><title>${escapeHtml(t.title)}</title><style>
${testReportAnalysisDocumentStyles}
</style></head><body><main>${renderTestReportAnalysisHtmlFragment(input, report, locale)}</main></body></html>`
}

export function renderTestReportAnalysisMarkdown(
  input: RenderableTestReportAnalysis,
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  const byId = new Map(input.analysis.findings.map((item) => [item.id, item]))
  const lines = [
    `# ${escapeMarkdown(t.title)} · ${escapeMarkdown(report.title)}`,
    "",
    `> ${escapeMarkdown(t.modelNotice)}`,
    "",
    `- ${t.analysisRevision}: ${input.revisionNumber}`,
    `- ${t.reportRevision}: ${report.reportRevisionNumber}`,
    `- ${t.model}: \`${escapeMarkdown(input.modelId)}\``,
    `- ${t.configuredModel}: \`${escapeMarkdown(input.configuredModelId)}\``,
    `- ${t.prompt}: \`${escapeMarkdown(input.promptVersion)}\``,
    `- ${t.runtimePolicy}: \`${escapeMarkdown(input.runtimePolicy.schemaVersion)}\` / ${formatDuration(input.runtimePolicy.timeoutMs)}`,
    "",
    `## ${t.summary}`,
    "",
    escapeMarkdown(input.analysis.summary),
    "",
    `## ${t.priorities}`,
    "",
  ]
  input.analysis.priorityOrder.forEach((id, index) => {
    const item = byId.get(id)
    if (!item) return
    lines.push(
      `### ${index + 1}. ${escapeMarkdown(item.title)}`,
      "",
      `- Kind: \`${item.kind}\` (${findingLabel(item.kind, locale)})`,
      `- Scope: \`${item.scope}\``,
      `- Confidence: \`${item.confidence}\``,
      `- Evidence: ${item.evidenceRefs.length}`,
      "",
      escapeMarkdown(item.statement),
      "",
    )
    for (const ref of item.evidenceRefs) {
      lines.push(
        `- [${escapeMarkdown(evidenceLabel(ref))}](${runUrl(
          report,
          evidenceEvalRevisionCaseId(
            report,
            ref,
            item.affectedEvalCaseIds,
          ),
        )})`,
      )
    }
    lines.push("")
    if (item.suggestedAction) {
      lines.push(`**${t.suggestedAction}:** ${escapeMarkdown(item.suggestedAction)}`, "")
    }
  })
  lines.push(`## ${t.limitations}`, "")
  for (const item of input.analysis.limitations) {
    lines.push(`- ${escapeMarkdown(item)}`)
  }
  if (!input.analysis.limitations.length) lines.push("—")
  lines.push("", `## ${t.usage}`, "")
  if (input.usage) {
    lines.push(
      `- ${t.tokens}: ${input.usage.inputTokens + input.usage.outputTokens}`,
      `- ${t.cost}: $${input.usage.totalCostUsd.toFixed(4)}`,
      `- ${t.duration}: ${formatDuration(input.usage.durationMs)}`,
    )
  } else {
    lines.push("—")
  }
  lines.push("", `---`, `${testReportAnalysisRendererVersion}`, "")
  return lines.join("\n")
}
