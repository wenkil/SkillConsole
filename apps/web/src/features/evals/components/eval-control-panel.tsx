import {
  Archive,
  Ban,
  FileCheck2,
  LockKeyhole,
  Play,
  Square,
} from "lucide-react"
import type { TFunction } from "i18next"

import type {
  EvalGenerationDraft,
  EvalGenerationTask,
  EvalRevision,
} from "@/features/evals/model/evals"
import { Button } from "@/shared/components/ui/button"

export function EvalControlPanel({
  activeTask,
  selectedTask,
  draft,
  revisions,
  targetOptions,
  selectedTargetKey,
  maxEvalCount,
  generationBrief,
  pending,
  onTargetChange,
  onCountChange,
  onBriefChange,
  onStart,
  onCancel,
  onPublish,
  onDiscard,
  t,
}: {
  activeTask: EvalGenerationTask | null
  selectedTask: EvalGenerationTask | null
  draft: EvalGenerationDraft | null
  revisions: readonly EvalRevision[]
  targetOptions: readonly {
    key: string
    label: string
    kind: "draft" | "version"
  }[]
  selectedTargetKey: string
  maxEvalCount: number
  generationBrief: string
  pending: boolean
  onTargetChange: (key: string) => void
  onCountChange: (count: number) => void
  onBriefChange: (brief: string) => void
  onStart: () => void
  onCancel: (taskId: string) => void
  onPublish: (taskId: string) => void
  onDiscard: (taskId: string) => void
  t: TFunction<"evals">
}) {
  const canPublish = draft?.status === "READY" && selectedTask

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-foreground bg-sidebar p-4">
      <section className="border border-foreground bg-paper-raised">
        <div className="border-b border-rule-soft px-4 py-3">
          <div className="technical-heading text-[10px] text-signal-dark">
            {t("controls.eyebrow")}
          </div>
          <h2 className="mt-1 text-base font-[760]">
            {t("controls.title")}
          </h2>
        </div>
        <div className="grid gap-4 p-4">
          <label className="grid gap-1.5 text-xs font-semibold">
            {t("controls.target")}
            <select
              className="h-9 w-full border border-foreground bg-background px-2.5 font-mono text-[11px] outline-none focus:border-primary"
              disabled={Boolean(activeTask) || pending}
              onChange={(event) => onTargetChange(event.target.value)}
              value={selectedTargetKey}
            >
              {targetOptions.map((target) => (
                <option key={target.key} value={target.key}>
                  {target.kind === "draft"
                    ? `${t("controls.draft")} · ${target.label}`
                    : `${t("controls.version")} · ${target.label}`}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            {t("controls.count")}
            <input
              className="h-9 w-full border border-foreground bg-background px-2.5 font-mono text-xs outline-none focus:border-primary"
              disabled={Boolean(activeTask) || pending}
              max={20}
              min={1}
              onChange={(event) =>
                onCountChange(Number(event.target.value))
              }
              type="number"
              value={maxEvalCount}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            {t("controls.brief")}
            <textarea
              className="min-h-24 resize-y border border-foreground bg-background p-2.5 text-xs leading-5 outline-none placeholder:text-muted-foreground focus:border-primary"
              disabled={Boolean(activeTask) || pending}
              maxLength={4000}
              onChange={(event) => onBriefChange(event.target.value)}
              placeholder={t("controls.briefPlaceholder")}
              value={generationBrief}
            />
          </label>
          <div className="border border-technical/45 bg-technical/6 p-3 text-[11px] leading-5 text-muted-foreground">
            <LockKeyhole className="mb-2 size-4 text-technical" />
            {t("controls.freezeHint")}
          </div>
          {activeTask ? (
            <Button
              className="w-full rounded-none"
              disabled={pending}
              onClick={() => onCancel(activeTask.id)}
              type="button"
              variant="outline"
            >
              <Square data-icon="inline-start" />
              {t("controls.cancel")}
            </Button>
          ) : (
            <Button
              className="w-full rounded-none"
              disabled={
                pending ||
                !selectedTargetKey ||
                !Number.isInteger(maxEvalCount) ||
                maxEvalCount < 1 ||
                maxEvalCount > 20
              }
              onClick={onStart}
              type="button"
            >
              <Play data-icon="inline-start" />
              {t("controls.start")}
            </Button>
          )}
        </div>
      </section>

      <section className="mt-4 border border-foreground bg-paper-raised">
        <div className="border-b border-rule-soft px-4 py-3">
          <div className="technical-heading text-[10px] text-signal-dark">
            {t("publish.eyebrow")}
          </div>
          <h2 className="mt-1 text-base font-[760]">{t("publish.title")}</h2>
        </div>
        <div className="p-4">
          {!draft ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("publish.noDraft")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px border border-rule bg-rule text-center">
                <div className="bg-background p-2.5">
                  <strong className="block text-lg">{draft.evalCount}</strong>
                  <span className="font-mono text-[9px] text-muted-foreground uppercase">
                    {t("publish.cases")}
                  </span>
                </div>
                <div className="bg-background p-2.5">
                  <strong className="block text-lg">{draft.fileCount}</strong>
                  <span className="font-mono text-[9px] text-muted-foreground uppercase">
                    {t("publish.files")}
                  </span>
                </div>
              </div>
              <div className="mt-3 border border-rule-soft bg-paper-muted p-2.5">
                <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                  Manifest
                </span>
                <code className="mt-1 block truncate font-mono text-[10px]">
                  {draft.manifestHash}
                </code>
              </div>
              {draft.status === "READY" ? (
                <div className="mt-3 grid gap-2">
                  <Button
                    className="w-full rounded-none"
                    disabled={pending || !canPublish}
                    onClick={() => {
                      if (
                        selectedTask &&
                        window.confirm(t("publish.confirm"))
                      ) {
                        onPublish(selectedTask.id)
                      }
                    }}
                    type="button"
                  >
                    <FileCheck2 data-icon="inline-start" />
                    {t("publish.action")}
                  </Button>
                  <Button
                    className="w-full rounded-none"
                    disabled={pending || !selectedTask}
                    onClick={() => {
                      if (
                        selectedTask &&
                        window.confirm(t("publish.discardConfirm"))
                      ) {
                        onDiscard(selectedTask.id)
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Ban data-icon="inline-start" />
                    {t("publish.discard")}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 border border-rule px-3 py-2 text-xs font-semibold">
                  {draft.status === "PUBLISHED" ? (
                    <FileCheck2 className="size-4 text-status-passed" />
                  ) : (
                    <Ban className="size-4 text-status-cancelled" />
                  )}
                  {t(`publish.status.${draft.status}`)}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="mt-4 border border-foreground bg-paper-raised">
        <div className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
          <h2 className="text-sm font-[760]">{t("revisions.title")}</h2>
          <Archive className="size-4 text-technical" />
        </div>
        <div className="max-h-52 overflow-y-auto p-2.5">
          {revisions.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {t("revisions.empty")}
            </p>
          ) : (
            revisions.map((revision) => (
              <div
                className="mb-1.5 border border-rule-soft px-3 py-2.5 last:mb-0"
                key={revision.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="font-mono text-[10px]">
                    EVALS R{revision.sequenceNumber}
                  </strong>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {revision.evalCount} / {revision.fileCount}
                  </span>
                </div>
                <code className="mt-1.5 block truncate font-mono text-[9px] text-muted-foreground">
                  {revision.manifestHash}
                </code>
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span className="shrink-0">
                    {t("revisions.sourceSnapshot")}
                  </span>
                  <code
                    className="min-w-0 truncate font-mono"
                    title={revision.sourceSnapshotId}
                  >
                    {revision.sourceSnapshotId}
                  </code>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}
