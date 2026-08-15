import {
  AlertTriangle,
  Check,
  Clock3,
  FileInput,
  FlaskConical,
  LoaderCircle,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import type {
  EvalCase,
  EvalGenerationDraft,
  EvalGenerationEvent,
  EvalGenerationTask,
} from "@/features/evals/model/evals"
import { buildEvalTraceEntries } from "@/features/evals/model/eval-trace"
import { cn } from "@/shared/lib/utils"

function eventSummary(event: EvalGenerationEvent, t: TFunction<"evals">) {
  if (event.type === "agent.usage") {
    return t("progress.usageUpdated")
  }
  return t(`event.${event.type}`, { defaultValue: event.type })
}

function failureMessage(
  code: string,
  t: TFunction<"evals">,
  commonT: TFunction<"common">,
) {
  if (code.startsWith("CLAUDE_")) {
    return commonT(`claudeErrors.${code}`, {
      defaultValue: t("error.generic"),
    })
  }
  const messages = {
    EVAL_OUTPUT_MISSING: "error.outputMissing",
    EVAL_OUTPUT_JSON_INVALID: "error.jsonInvalid",
    EVAL_GENERATION_START_FAILED: "error.startFailed",
  } as const
  const key =
    messages[code as keyof typeof messages] ?? "error.generic"
  return t(key)
}

export function EvalGenerationProgress({
  task,
  events,
  t,
}: {
  task: EvalGenerationTask
  events: readonly EvalGenerationEvent[]
  t: TFunction<"evals">
}) {
  const { t: commonT } = useTranslation("common")
  const stages = ["PREPARING", "RUNNING", "SUCCEEDED"] as const
  const displayStatus = task.status === "VALIDATING" ? "RUNNING" : task.status
  const currentIndex =
    task.status === "CANCELING"
      ? 1
      : Math.max(stages.indexOf(displayStatus as (typeof stages)[number]), 0)
  const terminalWithoutDraft = [
    "FAILED",
    "INTERRUPTED",
    "CANCELED",
  ].includes(task.status)
  const generationSucceeded = task.status === "SUCCEEDED"
  const traceEntries = buildEvalTraceEntries(events)

  return (
    <div className="flex h-full min-h-0 w-full flex-col px-5 py-4">
      <div className="border-b border-foreground pb-3">
        <div className="technical-heading text-[10px] text-signal-dark">
          {t("progress.eyebrow")}
        </div>
        <h2 className="mt-1 text-lg font-[780] tracking-[-0.02em]">
          {terminalWithoutDraft
            ? t("progress.endedTitle")
            : t("progress.title")}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("progress.description", { skillName: task.target.skillName })}
        </p>
      </div>

      <ol className="mt-3 grid grid-cols-3 border border-foreground bg-paper-raised">
        {stages.map((stage, index) => (
          <li
            className={cn(
              "relative border-r border-rule-soft px-3 py-2 last:border-r-0",
              index <= currentIndex && "bg-technical/6",
            )}
            key={stage}
          >
            <div className="font-mono text-[9px] text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold">
              {index < currentIndex ||
              (generationSucceeded && index === currentIndex) ? (
                <Check className="size-3.5 text-status-passed" />
              ) : index === currentIndex && !terminalWithoutDraft ? (
                <LoaderCircle className="size-3.5 animate-spin text-status-running" />
              ) : (
                <span className="size-2 border border-rule bg-paper-muted" />
              )}
              {t(`status.${stage}`)}
            </div>
          </li>
        ))}
      </ol>

      {generationSucceeded && !task.draftId ? (
        <div className="mt-5 border border-rule bg-paper-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
          {t("progress.noReviewableCases")}
        </div>
      ) : null}

      {task.error ? (
        <div className="mt-5 border border-destructive/60 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {failureMessage(task.error.code, t, commonT)}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden border border-foreground bg-trace text-trace-foreground">
        <div className="flex shrink-0 items-center justify-between border-b border-white/15 px-4 py-2.5">
          <span className="technical-heading text-[10px]">
            {t("progress.trace")}
          </span>
          <span className="font-mono text-[9px] text-white/55">
            {traceEntries.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-6 font-mono text-[10px]">
          {traceEntries.length === 0 ? (
            <div className="flex items-center gap-2 text-white/55">
              <LoaderCircle className="size-3 animate-spin" />
              {t("progress.waiting")}
            </div>
          ) : (
            traceEntries.map((entry) => (
              <div
                className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-white/8 py-2 last:border-0"
                key={entry.sequence}
              >
                <span className="text-white/35">
                  #{entry.sequence}
                </span>
                {entry.kind === "tool" ? (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[10px] text-white">
                        {t("progress.toolLabel", {
                          name:
                            entry.toolName ??
                            t("progress.unknownTool"),
                        })}
                      </strong>
                      <span
                        className={cn(
                          "border px-1.5 py-0.5 text-[8px] font-bold uppercase",
                          entry.isError
                            ? "border-destructive/70 text-destructive"
                            : "border-status-passed/60 text-status-passed",
                        )}
                      >
                        {entry.isError
                          ? t("progress.toolFailed")
                          : t("progress.toolSucceeded")}
                      </span>
                    </div>
                    <pre className="mt-1.5 max-h-32 overflow-auto border-l border-white/20 pl-2 whitespace-pre-wrap break-all text-[9px] leading-4 text-white/65">
                      {entry.output ??
                        (entry.toolName === "Read"
                          ? t("progress.readPathUnavailable")
                          : t("progress.noToolOutput"))}
                    </pre>
                  </div>
                ) : entry.kind === "message" ? (
                  <div className="min-w-0">
                    <strong className="text-[10px] text-white">
                      {t("progress.messageLabel")}
                    </strong>
                    <pre className="mt-1.5 max-h-32 overflow-auto border-l border-white/20 pl-2 whitespace-pre-wrap break-words text-[9px] leading-4 text-white/65">
                      {entry.content}
                    </pre>
                  </div>
                ) : (
                  <span>{eventSummary(entry.event, t)}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function CaseDetail({
  evalCase,
  t,
}: {
  evalCase: EvalCase
  t: TFunction<"evals">
}) {
  return (
    <article className="min-w-0 overflow-y-auto px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground pb-4">
        <div>
          <div className="font-mono text-[10px] font-bold text-signal-dark uppercase">
            Eval {String(evalCase.externalId).padStart(2, "0")}
          </div>
          <h3 className="mt-1 text-xl font-[760] tracking-[-0.025em]">
            {evalCase.name}
          </h3>
        </div>
        <span className="border border-technical/45 bg-technical/8 px-2 py-1 font-mono text-[9px] font-bold text-technical-foreground">
          {t("review.assertionCount", {
            count: evalCase.assertions.length,
          })}
        </span>
      </div>

      <section className="mt-5">
        <h4 className="flex items-center gap-2 text-xs font-bold">
          <MessageSquareText className="size-4 text-technical" />
          {t("review.prompt")}
        </h4>
        <p className="mt-2 border-l-3 border-primary bg-paper-muted px-4 py-3 text-sm leading-6">
          {evalCase.prompt}
        </p>
      </section>

      <section className="mt-5">
        <h4 className="text-xs font-bold">{t("review.expectedOutput")}</h4>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {evalCase.expectedOutput}
        </p>
      </section>

      <section className="mt-5">
        <h4 className="flex items-center gap-2 text-xs font-bold">
          <ShieldCheck className="size-4 text-technical" />
          {t("review.assertions")}
        </h4>
        <ol className="mt-2 grid gap-2">
          {evalCase.assertions.map((assertion, index) => (
            <li
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] border border-rule-soft bg-paper-raised px-3 py-2.5 text-xs leading-5"
              key={`${evalCase.externalId}:${index}`}
            >
              <span className="font-mono text-[9px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              {assertion}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5">
        <h4 className="flex items-center gap-2 text-xs font-bold">
          <FileInput className="size-4 text-technical" />
          {t("review.inputFiles")}
        </h4>
        {evalCase.files.length === 0 ? (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {t("review.noInputFiles")}
          </p>
        ) : (
          <div className="mt-2 grid gap-1.5">
            {evalCase.files.map((file) => (
              <code
                className="border border-rule-soft bg-paper-muted px-3 py-2 font-mono text-[10px]"
                key={file}
              >
                {file}
              </code>
            ))}
          </div>
        )}
      </section>
    </article>
  )
}

export function EvalDraftReview({
  task,
  draft,
  loading,
  t,
}: {
  task: EvalGenerationTask | null
  draft: EvalGenerationDraft | null
  loading: boolean
  t: TFunction<"evals">
}) {
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(
    null,
  )
  const selectedCase =
    draft?.cases.find((item) => item.externalId === selectedCaseId) ??
    draft?.cases[0] ??
    null

  if (!task) {
    return (
      <section className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-sm">
          <FlaskConical className="mx-auto size-9 text-technical" />
          <h2 className="mt-4 text-xl font-[760]">{t("review.emptyTitle")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("review.emptyDescription")}
          </p>
        </div>
      </section>
    )
  }
  if (!draft) {
    if (loading && task.status === "SUCCEEDED") {
      return (
        <div className="flex h-full items-center justify-center gap-2 text-xs">
          <LoaderCircle className="size-4 animate-spin" />
          {t("review.loadingDraft")}
        </div>
      )
    }
    return (
      <section className="flex h-full items-center justify-center px-8 text-center">
        <div className="max-w-sm">
          <Clock3 className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-[760]">
            {t("review.resultPendingTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("review.resultPendingDescription")}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-foreground px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="technical-heading text-[10px] text-signal-dark">
              {t("review.eyebrow")}
            </div>
            <h2 className="mt-1 text-lg font-[760]">{t("review.title")}</h2>
          </div>
          <div className="flex gap-2 font-mono text-[9px]">
            <span className="border border-rule px-2 py-1">
              {t("review.caseCount", { count: draft.evalCount })}
            </span>
            <span className="border border-rule px-2 py-1">
              {t("review.fileCount", { count: draft.fileCount })}
            </span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-rule-soft bg-paper-muted/45 p-2.5">
          {draft.cases.map((evalCase) => (
            <button
              className={cn(
                "mb-1.5 w-full border px-3 py-2.5 text-left",
                selectedCase?.externalId === evalCase.externalId
                  ? "border-primary bg-paper-raised shadow-[inset_3px_0_0_var(--primary)]"
                  : "border-transparent hover:border-rule hover:bg-paper-raised",
              )}
              key={evalCase.externalId}
              onClick={() => setSelectedCaseId(evalCase.externalId)}
              type="button"
            >
              <span className="font-mono text-[9px] text-muted-foreground">
                EVAL {String(evalCase.externalId).padStart(2, "0")}
              </span>
              <strong className="mt-1 block text-xs leading-5">
                {evalCase.name}
              </strong>
            </button>
          ))}
        </div>
        {selectedCase ? <CaseDetail evalCase={selectedCase} t={t} /> : null}
      </div>
    </section>
  )
}
