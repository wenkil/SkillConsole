import type {
  ReportMetricValue,
  ReportSideMetrics,
  StructuredTestReportV1,
} from "./test-report.domain.js"

export type TestReportDocumentLocale = "en" | "zh-CN"
export type TestReportDocumentFormat = "html" | "markdown"

export const testReportDocumentRendererVersion =
  "test-report-document-renderer-v1"

const copy = {
  en: {
    report: "Test report",
    skillEffect: "Skill effect",
    versionComparison: "Version comparison",
    run: "Original test Run",
    downloadHtml: "Download HTML",
    generated: "Generated",
    revision: "Report Revision",
    subjects: "Test subjects",
    baseline: "Baseline",
    target: "Target / Candidate",
    comparability: "Comparability and limitations",
    completeness: "Evidence completeness",
    complete: "Complete",
    partial: "Partial",
    metrics: "Metric overview",
    correctness: "Correctness and coverage",
    activation: "Skill activation observed",
    scripts: "Bundled script use observed",
    efficiency: "Latency, Token, and cost",
    issues: "Issues and changes",
    cases: "Per-Eval results",
    usage: "Usage and artifacts",
    environment: "Environment and reproducibility",
    evidence: "Evidence index",
    passRate: "Decisive assertion pass rate",
    coverage: "Assessment coverage",
    casePassRate: "Case pass rate",
    observedRate: "Observed rate",
    scriptRate: "Observed Case rate",
    outputConsistency: "Output consistency",
    skillToolCalls: "Skill tool calls observed",
    scriptCalls: "Bundled script calls observed",
    available: "Available",
    calls: "Observed calls",
    noData: "No data",
    noIssues: "No deterministic issues were recorded.",
    notApplicable: "Not applicable",
    sampleInsufficient: "Insufficient sample",
    missingData: "Missing data",
    notComparable: "Not comparable",
    status: "Status",
    value: "Value",
    sample: "Sample",
    delta: "Target − Baseline",
    transition: "Transition",
    baselineOutcome: "Baseline outcome",
    targetOutcome: "Target outcome",
    classification: "Classification",
    assertion: "Assertion",
    artifacts: "Artifacts",
    output: "Output facts",
    inputTokens: "Input tokens",
    outputTokens: "Output tokens",
    cost: "Cost",
    activeDuration: "Active duration",
    wallClock: "Run wall-clock",
    turns: "Turns",
    count: "Count",
    bytes: "Bytes",
    limitations: "Limitations",
    reportNotice:
      "This static report presents deterministic facts. It does not declare a winner, approve a release, or prove root cause.",
    legacyEnvironment:
      "The historical Run has no captured environment snapshot.",
    runtimeCapabilities: "Runtime capabilities",
    traceability: "Traceability fingerprints",
    issueSide: "Side",
    issueScope: "Scope",
    issueTriage: "Triage",
    eval: "Eval",
    openEvidence: "Open original evidence",
    document: "Static HTML document",
  },
  "zh-CN": {
    report: "测试报告",
    skillEffect: "Skill 效果测试",
    versionComparison: "版本对比测试",
    run: "查看原始测试任务",
    downloadHtml: "下载 HTML",
    generated: "生成时间",
    revision: "报告修订",
    subjects: "测试对象",
    baseline: "基线",
    target: "目标 / 候选",
    comparability: "可比性与限制",
    completeness: "证据完整性",
    complete: "完整",
    partial: "部分",
    metrics: "指标概览",
    correctness: "正确性与证据覆盖",
    activation: "观察到的 Skill 激活",
    scripts: "观察到的 bundled script 使用",
    efficiency: "延迟、Token 与成本",
    issues: "问题与变化",
    cases: "逐 Eval 结果",
    usage: "Usage 与 Artifact",
    environment: "环境与可复现性",
    evidence: "证据索引",
    passRate: "已判定 Assertion 通过率",
    coverage: "评分覆盖率",
    casePassRate: "Case 通过率",
    observedRate: "观察率",
    scriptRate: "观察到使用的 Case 比率",
    outputConsistency: "输出一致性",
    skillToolCalls: "观察到的 Skill 工具调用",
    scriptCalls: "观察到的 bundled script 调用",
    available: "可计算",
    calls: "观察调用次数",
    noData: "无数据",
    noIssues: "未记录到确定性问题。",
    notApplicable: "不适用",
    sampleInsufficient: "样本不足",
    missingData: "数据缺失",
    notComparable: "不可比较",
    status: "状态",
    value: "数值",
    sample: "样本",
    delta: "目标 − 基线",
    transition: "变化",
    baselineOutcome: "基线结果",
    targetOutcome: "目标结果",
    classification: "分类",
    assertion: "Assertion",
    artifacts: "Artifact",
    output: "输出事实",
    inputTokens: "输入 Token",
    outputTokens: "输出 Token",
    cost: "成本",
    activeDuration: "活动耗时",
    wallClock: "任务墙钟耗时",
    turns: "轮次",
    count: "数量",
    bytes: "字节",
    limitations: "限制",
    reportNotice:
      "本静态报告只呈现确定性事实，不宣布胜出、不代替上线验收，也不把相关性表述为已证实根因。",
    legacyEnvironment: "该历史任务没有已捕获的运行环境快照。",
    runtimeCapabilities: "运行能力",
    traceability: "追溯指纹",
    issueSide: "侧别",
    issueScope: "范围",
    issueTriage: "分诊",
    eval: "Eval",
    openEvidence: "打开原始证据",
    document: "静态 HTML 文档",
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
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
}

function formatNumber(value: number, locale: TestReportDocumentLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
    value,
  )
}

function formatDate(value: string | null, locale: TestReportDocumentLocale): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value))
}

function formatDuration(value: number | null): string {
  if (value === null) return "—"
  const sign = value < 0 ? "−" : ""
  const absolute = Math.abs(value)
  if (absolute < 1_000) return `${sign}${Math.round(absolute)} ms`
  const seconds = absolute / 1_000
  if (seconds < 60) return `${sign}${seconds.toFixed(1)} s`
  return `${sign}${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`
}

function metricStatus(
  metric: ReportMetricValue,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return {
    AVAILABLE: metric.value === null ? t.noData : t.available,
    NOT_APPLICABLE: t.notApplicable,
    INSUFFICIENT_SAMPLE: t.sampleInsufficient,
    MISSING_DATA: t.missingData,
    NOT_COMPARABLE: t.notComparable,
  }[metric.status]
}

function metricValue(metric: ReportMetricValue): string {
  return formatPercent(metric.value)
}

function metricSample(metric: ReportMetricValue): string {
  return metric.numerator === null || metric.denominator === null
    ? "—"
    : `${metric.numerator} / ${metric.denominator}`
}

function runUrl(report: StructuredTestReportV1, externalId?: number): string {
  const root = `/workbenches/${encodeURIComponent(report.workspaceId)}/runs/${encodeURIComponent(report.runId)}`
  return externalId === undefined ? root : `${root}?externalId=${externalId}`
}

export function getTestReportDocumentFilename(
  report: StructuredTestReportV1,
  format: TestReportDocumentFormat,
): string {
  const prefix =
    report.reportType === "skill_effect" ? "skill-effect" : "version-comparison"
  const extension = format === "markdown" ? "md" : "html"
  return `${prefix}-${report.runId.slice(0, 8)}-r${report.reportRevisionNumber}.${extension}`
}

function htmlMetricRow(
  label: string,
  baseline: ReportMetricValue,
  target: ReportMetricValue,
  delta: number | null,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return `<tr><th>${escapeHtml(label)}</th><td><strong>${metricValue(baseline)}</strong><small>${escapeHtml(metricStatus(baseline, locale))} · ${metricSample(baseline)}</small></td><td><strong>${metricValue(target)}</strong><small>${escapeHtml(metricStatus(target, locale))} · ${metricSample(target)}</small></td><td>${escapeHtml(formatPercent(delta))}</td></tr>`
}

function usageRows(
  baseline: ReportSideMetrics,
  target: ReportSideMetrics,
  locale: TestReportDocumentLocale,
  comparable: boolean,
): string {
  const t = copy[locale]
  const baselineUsage = baseline.usage.combined
  const targetUsage = target.usage.combined
  const rows: readonly [string, string, string, string][] = [
    [
      t.inputTokens,
      formatNumber(baselineUsage.inputTokens, locale),
      formatNumber(targetUsage.inputTokens, locale),
      comparable
        ? formatNumber(targetUsage.inputTokens - baselineUsage.inputTokens, locale)
        : t.notComparable,
    ],
    [
      t.outputTokens,
      formatNumber(baselineUsage.outputTokens, locale),
      formatNumber(targetUsage.outputTokens, locale),
      comparable
        ? formatNumber(targetUsage.outputTokens - baselineUsage.outputTokens, locale)
        : t.notComparable,
    ],
    [
      t.cost,
      `$${baselineUsage.totalCostUsd.toFixed(4)}`,
      `$${targetUsage.totalCostUsd.toFixed(4)}`,
      comparable
        ? `$${(targetUsage.totalCostUsd - baselineUsage.totalCostUsd).toFixed(4)}`
        : t.notComparable,
    ],
    [
      t.activeDuration,
      formatDuration(baselineUsage.durationMs),
      formatDuration(targetUsage.durationMs),
      comparable
        ? formatDuration(targetUsage.durationMs - baselineUsage.durationMs)
        : t.notComparable,
    ],
    [
      t.turns,
      String(baselineUsage.numTurns),
      String(targetUsage.numTurns),
      comparable
        ? String(targetUsage.numTurns - baselineUsage.numTurns)
        : t.notComparable,
    ],
  ]
  return rows
    .map(
      ([label, baselineValue, targetValue, delta]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(baselineValue)}</td><td>${escapeHtml(targetValue)}</td><td>${escapeHtml(delta)}</td></tr>`,
    )
    .join("")
}

function htmlSubject(
  label: string,
  subject: StructuredTestReportV1["subjects"]["target"],
): string {
  return `<article class="subject"><span>${escapeHtml(label)}</span><h3>${escapeHtml(subject.label)}</h3><dl><div><dt>Kind</dt><dd>${escapeHtml(subject.kind)}</dd></div><div><dt>Version</dt><dd>${escapeHtml(subject.versionNumber === null ? "—" : `R${subject.versionNumber}`)}</dd></div><div><dt>Manifest</dt><dd><code>${escapeHtml(subject.manifestHash?.slice(0, 16) ?? "—")}</code></dd></div><div><dt>Scripts</dt><dd>${subject.declaredBundledScripts.length}</dd></div></dl></article>`
}

function htmlCases(
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  return report.cases
    .map((item) => {
      const comparable = item.pairComparability === "COMPARABLE"
      const assertions = item.assertionTransitions.length
        ? item.assertionTransitions
            .map(
              (assertion) =>
                `<tr><td>${assertion.assertionIndex + 1}</td><td>${escapeHtml(assertion.assertion)}</td><td><span class="pill status-${escapeHtml(assertion.baselineStatus ?? "none")}">${escapeHtml(assertion.baselineStatus ?? "—")}</span></td><td><span class="pill status-${escapeHtml(assertion.targetStatus ?? "none")}">${escapeHtml(assertion.targetStatus ?? "—")}</span></td><td><strong>${escapeHtml(assertion.transition)}</strong></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="5">${escapeHtml(t.noData)}</td></tr>`
      const issueCount = item.issueIds.length
      const artifactSummary = comparable
        ? [
            `+${item.artifactDiff.added.length}`,
            `−${item.artifactDiff.removed.length}`,
            `Δ${item.artifactDiff.changed.length}`,
            `=${item.artifactDiff.unchanged.length}`,
          ].join(" · ")
        : t.notComparable
      const outputSummary = comparable
        ? `raw ${String(item.outputDiff.rawEqual)} · normalized ${String(item.outputDiff.normalizedEqual)} · chars Δ ${item.outputDiff.characterDelta ?? "—"}`
        : t.notComparable
      return `<details class="case" ${issueCount > 0 ? "open" : ""}><summary><span>${escapeHtml(t.eval)} ${item.externalId}</span><strong>${escapeHtml(item.name)}</strong><span class="pill">${escapeHtml(item.classification)}</span><span>${issueCount} ${escapeHtml(t.issues)}</span></summary><div class="case-body"><div class="case-grid"><dl><div><dt>${escapeHtml(t.baselineOutcome)}</dt><dd>${escapeHtml(item.baselineOutcome ?? "—")}</dd></div><div><dt>${escapeHtml(t.targetOutcome)}</dt><dd>${escapeHtml(item.targetOutcome ?? "—")}</dd></div><div><dt>${escapeHtml(t.classification)}</dt><dd>${escapeHtml(item.classification)}</dd></div><div><dt>${escapeHtml(t.status)}</dt><dd>${escapeHtml(item.pairComparability)}</dd></div></dl><dl><div><dt>${escapeHtml(t.output)}</dt><dd>${escapeHtml(outputSummary)}</dd></div><div><dt>${escapeHtml(t.artifacts)}</dt><dd>${escapeHtml(artifactSummary)}</dd></div><div><dt>${escapeHtml(t.cost)}</dt><dd>${item.usageDelta.executionCostUsd === null || item.usageDelta.gradingCostUsd === null ? "—" : `$${(item.usageDelta.executionCostUsd + item.usageDelta.gradingCostUsd).toFixed(4)}`}</dd></div><div><dt>${escapeHtml(t.activeDuration)}</dt><dd>${escapeHtml(formatDuration(item.usageDelta.activeDurationMs))}</dd></div></dl></div><table><thead><tr><th>#</th><th>${escapeHtml(t.assertion)}</th><th>${escapeHtml(t.baseline)}</th><th>${escapeHtml(t.target)}</th><th>${escapeHtml(t.transition)}</th></tr></thead><tbody>${assertions}</tbody></table><p class="evidence-link"><a target="_top" href="${escapeHtml(runUrl(report, item.externalId))}">${escapeHtml(t.openEvidence)} →</a></p></div></details>`
    })
    .join("")
}

function htmlEnvironment(
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  if (report.environment.status === "legacy_unavailable") {
    return `<p class="notice warning">${escapeHtml(t.legacyEnvironment)}</p>`
  }
  const environment = report.environment
  const capabilities = environment.runtimeCapabilities.length
    ? `<ul>${environment.runtimeCapabilities.map((capability) => `<li><code>${escapeHtml(capability.capability)}</code><ul>${capability.commands.map((command) => `<li><code>${escapeHtml(command.name)}</code> · ${command.available ? "available" : "unavailable"} · ${escapeHtml(command.version ?? "—")}</li>`).join("")}</ul></li>`).join("")}</ul>`
    : `<p>${escapeHtml(t.noData)}</p>`
  return `<div class="environment-grid"><dl><div><dt>Node</dt><dd>${escapeHtml(environment.nodeVersion)}</dd></div><div><dt>OS / Arch</dt><dd>${escapeHtml(environment.platform)} / ${escapeHtml(environment.architecture)}</dd></div><div><dt>SDK</dt><dd>${escapeHtml(environment.sdkVersion)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(environment.model)}</dd></div><div><dt>Execution policy</dt><dd>${escapeHtml(environment.executionPolicy)}</dd></div><div><dt>Prompt / Grader</dt><dd>${escapeHtml(environment.executionPromptVersion)} / ${escapeHtml(environment.graderProtocolVersion)}</dd></div></dl><div><h3>${escapeHtml(t.runtimeCapabilities)}</h3>${capabilities}</div></div>`
}

export function renderTestReportHtml(
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  const mode =
    report.reportType === "skill_effect" ? t.skillEffect : t.versionComparison
  const baseline = report.metrics.baseline
  const target = report.metrics.target
  const issues = report.issues.items.length
    ? `<div class="issue-list">${report.issues.items.map((issue) => `<article class="issue"><div><span class="pill issue-${escapeHtml(issue.triage)}">${escapeHtml(issue.kind)}</span><span>${escapeHtml(t.eval)} ${issue.externalId}</span></div><h3>${escapeHtml(issue.title)}</h3><p>${escapeHtml(t.issueSide)}: ${escapeHtml(issue.side ?? "—")} · ${escapeHtml(t.issueScope)}: ${escapeHtml(issue.scope)} · ${escapeHtml(t.issueTriage)}: ${escapeHtml(issue.triage)}</p><a target="_top" href="${escapeHtml(runUrl(report, issue.externalId))}">${escapeHtml(t.openEvidence)} →</a></article>`).join("")}</div>`
    : `<p class="notice">${escapeHtml(t.noIssues)}</p>`
  const comparisonReasons = [
    ...report.comparability.reasons,
    ...report.completeness.reasons,
    ...report.limitations.map((item) => item.message),
  ]
  const reasons = comparisonReasons.length
    ? `<ul>${comparisonReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(t.complete)}</p>`
  const transitionRows = Object.entries(report.transitions.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, count]) =>
        `<tr><th>${escapeHtml(name)}</th><td>${count}</td></tr>`,
    )
    .join("")
  const traceability = Object.entries(report.traceability)
    .map(
      ([name, value]) =>
        `<tr><th>${escapeHtml(name)}</th><td><code>${escapeHtml(value ?? "—")}</code></td></tr>`,
    )
    .join("")
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${testReportDocumentRendererVersion}">
<title>${escapeHtml(report.title)} · ${escapeHtml(t.report)}</title>
<style>
:root{color-scheme:light;--ink:#191816;--muted:#6e675f;--paper:#f5f1e8;--raised:#fffdf7;--rule:#c8c0b4;--accent:#e86041;--good:#28734f;--bad:#b33b32;--warn:#966414;--code:#272522}*{box-sizing:border-box}html{background:var(--paper);color:var(--ink);font-family:Inter,"Segoe UI",sans-serif;line-height:1.55}body{margin:0}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:32px 0 72px}.hero{border:1px solid var(--ink);background:var(--raised);padding:28px}.eyebrow,.meta,dt,.pill,th{font-family:"SFMono-Regular",Consolas,monospace}.eyebrow{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.hero h1{font-size:clamp(30px,5vw,56px);line-height:1.02;margin:10px 0 16px;letter-spacing:-.045em}.hero-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.hero-actions a{border:1px solid var(--ink);padding:8px 12px;background:var(--paper);font-size:13px;font-weight:700}.meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font-size:11px}.notice{border-left:4px solid var(--accent);background:var(--raised);padding:14px 16px}.warning{border-color:var(--warn)}section{margin-top:28px}section>h2{border-bottom:2px solid var(--ink);padding-bottom:8px;font-size:22px}.subjects,.metric-grid,.case-grid,.environment-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.subject,.metric-card,.issue{border:1px solid var(--rule);background:var(--raised);padding:16px}.subject>span,.metric-card>span{font-family:Consolas,monospace;color:var(--muted);font-size:10px;text-transform:uppercase}.subject h3{font-size:20px;margin:7px 0 14px}.subject dl,.case-grid dl,.environment-grid dl{margin:0}.subject dl div,.case-grid dl div,.environment-grid dl div{display:grid;grid-template-columns:120px 1fr;gap:12px;border-top:1px solid var(--rule);padding:7px 0}.subject dt,.case-grid dt,.environment-grid dt{font-size:10px;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.metric-card strong{display:block;font-size:30px;line-height:1.1;margin:8px 0 4px}.metric-card small{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--raised);font-size:12px}th,td{border:1px solid var(--rule);padding:9px;text-align:left;vertical-align:top}th{font-size:10px}.metrics-table td strong,.metrics-table td small{display:block}.metrics-table td small{color:var(--muted);margin-top:3px}.pill{display:inline-block;border:1px solid var(--rule);padding:2px 6px;font-size:9px;font-weight:700}.status-PASSED{color:var(--good);border-color:var(--good)}.status-FAILED,.status-EXECUTION_ERROR,.status-ASSESSMENT_ERROR,.issue-ACTIONABLE_RESULT{color:var(--bad);border-color:var(--bad)}.status-INSUFFICIENT_EVIDENCE,.issue-INVESTIGATE,.issue-BLOCKING_EVIDENCE{color:var(--warn);border-color:var(--warn)}.issue-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.issue h3{margin:10px 0 4px}.issue p{color:var(--muted);font-size:12px}.case{border:1px solid var(--rule);background:var(--raised);margin-bottom:10px}.case summary{display:grid;grid-template-columns:70px minmax(180px,1fr) auto auto;align-items:center;gap:10px;cursor:pointer;padding:14px}.case summary::marker{color:var(--accent)}.case-body{border-top:1px solid var(--rule);padding:16px}.case-body table{margin-top:14px}.evidence-link{text-align:right}.environment-grid>div{border:1px solid var(--rule);background:var(--raised);padding:16px}.environment-grid h3{margin-top:0}code{font-family:Consolas,monospace;font-size:.9em;overflow-wrap:anywhere}.footer{margin-top:36px;border-top:1px solid var(--ink);padding-top:16px;color:var(--muted);font-size:11px}@media(max-width:760px){main{width:min(100% - 18px,1180px);padding-top:10px}.hero{padding:18px}.subjects,.metric-grid,.case-grid,.environment-grid,.issue-list{grid-template-columns:1fr}.case summary{grid-template-columns:60px 1fr}.case summary>*:nth-child(n+3){display:none}.table-scroll{overflow-x:auto}table{min-width:650px}}@media print{main{width:100%;padding:0}.hero-actions{display:none}.case{break-inside:avoid}details:not([open])>.case-body{display:block}.hero,section{break-inside:avoid}}
</style>
</head>
<body><main>
<header class="hero"><div class="eyebrow">${escapeHtml(t.report)} · ${escapeHtml(mode)}</div><h1>${escapeHtml(report.title)}</h1><p class="notice">${escapeHtml(t.reportNotice)}</p><div class="meta"><span>REPORT ${escapeHtml(report.reportId)}</span><span>RUN ${escapeHtml(report.runId)}</span><span>${escapeHtml(t.revision)} ${report.reportRevisionNumber}</span><span>${escapeHtml(t.generated)} ${escapeHtml(formatDate(report.generatedAt, locale))}</span><span>${escapeHtml(report.status)}</span></div><div class="hero-actions"><a target="_top" href="${escapeHtml(runUrl(report))}">${escapeHtml(t.run)}</a></div></header>
<section><h2>${escapeHtml(t.subjects)}</h2><div class="subjects">${htmlSubject(t.baseline, report.subjects.baseline)}${htmlSubject(t.target, report.subjects.target)}</div></section>
<section><h2>${escapeHtml(t.comparability)}</h2><p><span class="pill">${escapeHtml(report.comparability.status)}</span> · ${escapeHtml(t.completeness)}: <strong>${escapeHtml(report.completeness.status === "COMPLETE" ? t.complete : t.partial)}</strong></p>${reasons}</section>
<section><h2>${escapeHtml(t.metrics)}</h2><div class="table-scroll"><table class="metrics-table"><thead><tr><th>${escapeHtml(t.metrics)}</th><th>${escapeHtml(t.baseline)}</th><th>${escapeHtml(t.target)}</th><th>${escapeHtml(t.delta)}</th></tr></thead><tbody>${htmlMetricRow(t.passRate, baseline.assertions.decisivePassRate, target.assertions.decisivePassRate, report.metrics.delta?.assertionPassRateAbsolute ?? null, locale)}${htmlMetricRow(t.coverage, baseline.assertions.assessmentCoverageRate, target.assertions.assessmentCoverageRate, null, locale)}${htmlMetricRow(t.casePassRate, baseline.caseQuality.casePassRate, target.caseQuality.casePassRate, report.metrics.delta?.casePassRateAbsolute ?? null, locale)}${htmlMetricRow(t.observedRate, baseline.activation.observedRate, target.activation.observedRate, report.metrics.delta?.activationObservedRateAbsolute ?? null, locale)}${htmlMetricRow(t.scriptRate, baseline.bundledScripts.observedCaseRate, target.bundledScripts.observedCaseRate, report.metrics.delta?.bundledScriptObservedRateAbsolute ?? null, locale)}</tbody></table></div><div class="metric-grid" style="margin-top:14px"><article class="metric-card"><span>${escapeHtml(t.outputConsistency)}</span><strong>${escapeHtml(t.sampleInsufficient)}</strong><small>${escapeHtml(t.baseline)} n=${baseline.outputConsistency.sampleCount} · ${escapeHtml(t.target)} n=${target.outputConsistency.sampleCount}</small></article><article class="metric-card"><span>${escapeHtml(t.skillToolCalls)}</span><strong>${target.activation.skillToolCallCount}</strong><small>${escapeHtml(t.baseline)} ${baseline.activation.skillToolCallCount} · ${escapeHtml(t.target)} ${target.activation.skillToolCallCount}</small></article><article class="metric-card"><span>${escapeHtml(t.scriptCalls)}</span><strong>${target.bundledScripts.callCount}</strong><small>${escapeHtml(t.baseline)} ${baseline.bundledScripts.callCount} · ${escapeHtml(t.target)} ${target.bundledScripts.callCount}</small></article><article class="metric-card"><span>${escapeHtml(t.issues)}</span><strong>${report.issues.total}</strong><small>+${report.transitions.positiveCount} / −${report.transitions.negativeCount}</small></article><article class="metric-card"><span>${escapeHtml(t.wallClock)}</span><strong>${escapeHtml(formatDuration(report.run.wallClockDurationMs))}</strong><small>${report.evalRevision.evalCount} Evals</small></article><article class="metric-card"><span>${escapeHtml(t.cost)}</span><strong>$${(baseline.usage.combined.totalCostUsd + target.usage.combined.totalCostUsd).toFixed(4)}</strong><small>execution + grader</small></article><article class="metric-card"><span>${escapeHtml(t.artifacts)}</span><strong>${baseline.artifacts.count + target.artifacts.count}</strong><small>${formatNumber(baseline.artifacts.totalBytes + target.artifacts.totalBytes, locale)} ${escapeHtml(t.bytes)}</small></article></div></section>
<section><h2>${escapeHtml(t.issues)}</h2>${issues}<h3>${escapeHtml(t.transition)}</h3><div class="table-scroll"><table><tbody>${transitionRows || `<tr><td>${escapeHtml(t.noData)}</td></tr>`}</tbody></table></div></section>
<section><h2>${escapeHtml(t.cases)}</h2>${htmlCases(report, locale)}</section>
<section><h2>${escapeHtml(t.usage)}</h2><div class="table-scroll"><table><thead><tr><th>${escapeHtml(t.value)}</th><th>${escapeHtml(t.baseline)}</th><th>${escapeHtml(t.target)}</th><th>${escapeHtml(t.delta)}</th></tr></thead><tbody>${usageRows(baseline, target, locale, report.metrics.delta !== null)}<tr><th>${escapeHtml(t.artifacts)}</th><td>${baseline.artifacts.count} / ${formatNumber(baseline.artifacts.totalBytes, locale)} ${escapeHtml(t.bytes)}</td><td>${target.artifacts.count} / ${formatNumber(target.artifacts.totalBytes, locale)} ${escapeHtml(t.bytes)}</td><td>${report.metrics.delta === null ? escapeHtml(t.notComparable) : target.artifacts.count - baseline.artifacts.count}</td></tr></tbody></table></div></section>
<section><h2>${escapeHtml(t.environment)}</h2>${htmlEnvironment(report, locale)}<h3>${escapeHtml(t.traceability)}</h3><div class="table-scroll"><table><tbody>${traceability}</tbody></table></div></section>
<footer class="footer">${escapeHtml(t.document)} · ${testReportDocumentRendererVersion} · ${escapeHtml(report.schemaVersion)} · ${escapeHtml(report.generatorVersion)} · SOURCE ${escapeHtml(report.sourceFingerprint)}</footer>
</main></body></html>`
}

function markdownMetricRow(
  label: string,
  baseline: ReportMetricValue,
  target: ReportMetricValue,
  delta: number | null,
  locale: TestReportDocumentLocale,
): string {
  return `| ${escapeMarkdown(label)} | ${metricValue(baseline)} (${escapeMarkdown(metricStatus(baseline, locale))}; ${metricSample(baseline)}) | ${metricValue(target)} (${escapeMarkdown(metricStatus(target, locale))}; ${metricSample(target)}) | ${formatPercent(delta)} |`
}

export function renderTestReportMarkdown(
  report: StructuredTestReportV1,
  locale: TestReportDocumentLocale,
): string {
  const t = copy[locale]
  const baseline = report.metrics.baseline
  const target = report.metrics.target
  const comparable = report.metrics.delta !== null
  const lines: string[] = [
    `# ${escapeMarkdown(report.title)}`,
    "",
    `> ${escapeMarkdown(t.reportNotice)}`,
    "",
    `- Report: \`${report.reportId}\``,
    `- Run: \`${report.runId}\``,
    `- ${escapeMarkdown(t.revision)}: ${report.reportRevisionNumber}`,
    `- ${escapeMarkdown(t.generated)}: ${escapeMarkdown(formatDate(report.generatedAt, locale))}`,
    `- ${escapeMarkdown(t.status)}: \`${report.status}\``,
    `- ${escapeMarkdown(t.run)}: [${escapeMarkdown(report.runId)}](${runUrl(report)})`,
    "",
    `## ${t.subjects}`,
    "",
    `| | ${t.baseline} | ${t.target} |`,
    "|---|---|---|",
    `| Label | ${escapeMarkdown(report.subjects.baseline.label)} | ${escapeMarkdown(report.subjects.target.label)} |`,
    `| Kind | \`${report.subjects.baseline.kind}\` | \`${report.subjects.target.kind}\` |`,
    `| Manifest | \`${report.subjects.baseline.manifestHash ?? "—"}\` | \`${report.subjects.target.manifestHash ?? "—"}\` |`,
    `| Scripts | ${report.subjects.baseline.declaredBundledScripts.length} | ${report.subjects.target.declaredBundledScripts.length} |`,
    "",
    `## ${t.comparability}`,
    "",
    `- ${t.status}: \`${report.comparability.status}\``,
    `- ${t.completeness}: \`${report.completeness.status}\``,
    ...[
      ...report.comparability.reasons,
      ...report.completeness.reasons,
      ...report.limitations.map((item) => item.message),
    ].map((reason) => `- ${escapeMarkdown(reason)}`),
    "",
    `## ${t.metrics}`,
    "",
    `| ${t.metrics} | ${t.baseline} | ${t.target} | ${t.delta} |`,
    "|---|---:|---:|---:|",
    markdownMetricRow(t.passRate, baseline.assertions.decisivePassRate, target.assertions.decisivePassRate, report.metrics.delta?.assertionPassRateAbsolute ?? null, locale),
    markdownMetricRow(t.coverage, baseline.assertions.assessmentCoverageRate, target.assertions.assessmentCoverageRate, null, locale),
    markdownMetricRow(t.casePassRate, baseline.caseQuality.casePassRate, target.caseQuality.casePassRate, report.metrics.delta?.casePassRateAbsolute ?? null, locale),
    markdownMetricRow(t.observedRate, baseline.activation.observedRate, target.activation.observedRate, report.metrics.delta?.activationObservedRateAbsolute ?? null, locale),
    markdownMetricRow(t.scriptRate, baseline.bundledScripts.observedCaseRate, target.bundledScripts.observedCaseRate, report.metrics.delta?.bundledScriptObservedRateAbsolute ?? null, locale),
    "",
    `- ${t.outputConsistency}: ${t.baseline} \`${baseline.outputConsistency.status}\` (n=${baseline.outputConsistency.sampleCount}); ${t.target} \`${target.outputConsistency.status}\` (n=${target.outputConsistency.sampleCount})`,
    `- ${t.skillToolCalls}: ${t.baseline} ${baseline.activation.skillToolCallCount}; ${t.target} ${target.activation.skillToolCallCount}`,
    `- ${t.scriptCalls}: ${t.baseline} ${baseline.bundledScripts.callCount}; ${t.target} ${target.bundledScripts.callCount}`,
    "",
    `## ${t.issues}`,
    "",
  ]
  if (report.issues.items.length === 0) lines.push(t.noIssues, "")
  for (const issue of report.issues.items) {
    lines.push(
      `### ${t.eval} ${issue.externalId} · ${escapeMarkdown(issue.title)}`,
      "",
      `- Kind: \`${issue.kind}\``,
      `- ${t.issueSide}: \`${issue.side ?? "—"}\``,
      `- ${t.issueScope}: \`${issue.scope}\``,
      `- ${t.issueTriage}: \`${issue.triage}\``,
      `- [${t.openEvidence}](${runUrl(report, issue.externalId)})`,
      "",
    )
  }
  lines.push(`## ${t.cases}`, "")
  for (const item of report.cases) {
    const pairComparable = item.pairComparability === "COMPARABLE"
    lines.push(
      `### ${t.eval} ${item.externalId} · ${escapeMarkdown(item.name)}`,
      "",
      `- ${t.classification}: \`${escapeMarkdown(item.classification)}\``,
      `- ${t.status}: \`${item.pairComparability}\``,
      `- ${t.baselineOutcome}: \`${item.baselineOutcome ?? "—"}\``,
      `- ${t.targetOutcome}: \`${item.targetOutcome ?? "—"}\``,
      `- ${t.output}: ${pairComparable ? `raw=${String(item.outputDiff.rawEqual)}, normalized=${String(item.outputDiff.normalizedEqual)}, chars Δ=${item.outputDiff.characterDelta ?? "—"}` : t.notComparable}`,
      `- ${t.artifacts}: ${pairComparable ? `+${item.artifactDiff.added.length}, −${item.artifactDiff.removed.length}, Δ${item.artifactDiff.changed.length}, =${item.artifactDiff.unchanged.length}` : t.notComparable}`,
      `- [${t.openEvidence}](${runUrl(report, item.externalId)})`,
      "",
      `| # | ${t.assertion} | ${t.baseline} | ${t.target} | ${t.transition} |`,
      "|---:|---|---|---|---|",
      ...(item.assertionTransitions.length
        ? item.assertionTransitions.map(
            (assertion) =>
              `| ${assertion.assertionIndex + 1} | ${escapeMarkdown(assertion.assertion)} | ${assertion.baselineStatus ?? "—"} | ${assertion.targetStatus ?? "—"} | ${assertion.transition} |`,
          )
        : [`|  | ${t.noData} |  |  |  |`]),
      "",
    )
  }
  lines.push(
    `## ${t.usage}`,
    "",
    `| ${t.value} | ${t.baseline} | ${t.target} | ${t.delta} |`,
    "|---|---:|---:|---:|",
    `| ${t.inputTokens} | ${baseline.usage.combined.inputTokens} | ${target.usage.combined.inputTokens} | ${comparable ? target.usage.combined.inputTokens - baseline.usage.combined.inputTokens : t.notComparable} |`,
    `| ${t.outputTokens} | ${baseline.usage.combined.outputTokens} | ${target.usage.combined.outputTokens} | ${comparable ? target.usage.combined.outputTokens - baseline.usage.combined.outputTokens : t.notComparable} |`,
    `| ${t.cost} | $${baseline.usage.combined.totalCostUsd.toFixed(4)} | $${target.usage.combined.totalCostUsd.toFixed(4)} | ${comparable ? `$${(target.usage.combined.totalCostUsd - baseline.usage.combined.totalCostUsd).toFixed(4)}` : t.notComparable} |`,
    `| ${t.activeDuration} | ${formatDuration(baseline.usage.combined.durationMs)} | ${formatDuration(target.usage.combined.durationMs)} | ${comparable ? formatDuration(target.usage.combined.durationMs - baseline.usage.combined.durationMs) : t.notComparable} |`,
    `| ${t.artifacts} | ${baseline.artifacts.count} / ${baseline.artifacts.totalBytes} ${t.bytes} | ${target.artifacts.count} / ${target.artifacts.totalBytes} ${t.bytes} | ${comparable ? target.artifacts.count - baseline.artifacts.count : t.notComparable} |`,
    "",
    `## ${t.environment}`,
    "",
  )
  if (report.environment.status === "legacy_unavailable") {
    lines.push(`> ${t.legacyEnvironment}`, "")
  } else {
    lines.push(
      `- Node: \`${escapeMarkdown(report.environment.nodeVersion)}\``,
      `- OS / Arch: \`${escapeMarkdown(report.environment.platform)} / ${escapeMarkdown(report.environment.architecture)}\``,
      `- SDK: \`${escapeMarkdown(report.environment.sdkVersion)}\``,
      `- Model: \`${escapeMarkdown(report.environment.model)}\``,
      `- Execution policy: \`${report.environment.executionPolicy}\``,
      "",
    )
  }
  lines.push(
    `## ${t.evidence}`,
    "",
    `- Source fingerprint: \`${report.sourceFingerprint}\``,
    `- Comparability fingerprint: \`${report.comparability.fingerprint}\``,
    `- Eval manifest: \`${report.evalRevision.manifestHash}\``,
    `- Run input fingerprint: \`${report.traceability.runInputFingerprint}\``,
    "",
    `---`,
    `${t.document} · ${testReportDocumentRendererVersion} · ${report.schemaVersion} · ${report.generatorVersion}`,
    "",
  )
  return lines.join("\n")
}
