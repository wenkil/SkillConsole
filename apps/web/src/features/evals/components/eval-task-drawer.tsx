import {
  Ban,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
  Play,
  RotateCcw,
  Square,
} from "lucide-react"
import type { TFunction } from "i18next"
import { useState } from "react"
import { Link } from "react-router-dom"

import {
  EvalDraftReview,
  EvalGenerationProgress,
} from "@/features/evals/components/eval-draft-review"
import {
  isActiveEvalGeneration,
  type EvalGenerationDraft,
  type EvalGenerationEvent,
  type EvalGenerationTask,
} from "@/features/evals/model/evals"
import { Button } from "@/shared/components/ui/button"
import { ConfirmationDialog } from "@/shared/components/confirmation-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { cn } from "@/shared/lib/utils"

type DrawerTab = "process" | "result"

type PendingConfirmation = {
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly confirmVariant: "default" | "destructive"
  readonly onConfirm: () => Promise<unknown>
}

interface TargetOption {
  readonly key: string
  readonly label: string
  readonly kind: "draft" | "version"
}

function GenerationSetup({
  targetOptions,
  selectedTargetKey,
  maxEvalCount,
  generationBrief,
  pending,
  generationBlocked,
  onTargetChange,
  onCountChange,
  onBriefChange,
  onStart,
  t,
}: {
  targetOptions: readonly TargetOption[]
  selectedTargetKey: string
  maxEvalCount: number
  generationBrief: string
  pending: boolean
  generationBlocked: boolean
  onTargetChange: (key: string) => void
  onCountChange: (count: number) => void
  onBriefChange: (brief: string) => void
  onStart: () => Promise<unknown>
  t: TFunction<"evals">
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-2xl">
        <div className="ui-label text-signal-dark">
          {t("controls.eyebrow")}
        </div>
        <h3 className="mt-1 text-xl font-[760]">{t("controls.title")}</h3>
        <div className="mt-6 grid gap-5">
          <label className="grid gap-1.5 text-sm font-semibold">
            {t("controls.target")}
            <select
              className="h-10 w-full border border-border-default bg-background px-3 font-mono text-sm outline-none focus:border-focus-ring"
              disabled={generationBlocked || pending}
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
          <label className="grid gap-1.5 text-sm font-semibold">
            {t("controls.count")}
            <input
              className="h-10 w-full border border-border-default bg-background px-3 font-mono text-sm outline-none focus:border-focus-ring"
              disabled={generationBlocked || pending}
              max={20}
              min={1}
              onChange={(event) => onCountChange(Number(event.target.value))}
              type="number"
              value={maxEvalCount}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            {t("controls.brief")}
            <textarea
              className="min-h-32 resize-y border border-border-default bg-background p-3 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:border-focus-ring"
              disabled={generationBlocked || pending}
              maxLength={4000}
              onChange={(event) => onBriefChange(event.target.value)}
              placeholder={t("controls.briefPlaceholder")}
              value={generationBrief}
            />
          </label>
          <div className="border border-technical/45 bg-technical/6 p-4 text-[13px] leading-5 text-muted-foreground">
            <LockKeyhole className="mb-2 size-4 text-technical" />
            {generationBlocked
              ? t("drawer.activeTaskHint")
              : t("controls.freezeHint")}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 mx-auto mt-7 flex max-w-2xl justify-end border-t border-border-default bg-background py-4">
        <Button
          className="min-w-44 rounded-none"
          disabled={
            generationBlocked ||
            pending ||
            !selectedTargetKey ||
            !Number.isInteger(maxEvalCount) ||
            maxEvalCount < 1 ||
            maxEvalCount > 20
          }
          onClick={() => {
            void onStart().catch(() => undefined)
          }}
          type="button"
        >
          <Play data-icon="inline-start" />
          {t("controls.start")}
        </Button>
      </div>
    </div>
  )
}

export function EvalTaskDrawer({
  open,
  creating,
  tab,
  task,
  draft,
  events,
  draftLoading,
  targetOptions,
  selectedTargetKey,
  maxEvalCount,
  generationBrief,
  pending,
  generationBlocked,
  workspaceId,
  savedRevisionId,
  onOpenChange,
  onTabChange,
  onTargetChange,
  onCountChange,
  onBriefChange,
  onStart,
  onCancel,
  onRetry,
  onSave,
  onDiscard,
  t,
}: {
  open: boolean
  creating: boolean
  tab: DrawerTab
  task: EvalGenerationTask | null
  draft: EvalGenerationDraft | null
  events: readonly EvalGenerationEvent[]
  draftLoading: boolean
  targetOptions: readonly TargetOption[]
  selectedTargetKey: string
  maxEvalCount: number
  generationBrief: string
  pending: boolean
  generationBlocked: boolean
  workspaceId: string
  savedRevisionId: string | null
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: DrawerTab) => void
  onTargetChange: (key: string) => void
  onCountChange: (count: number) => void
  onBriefChange: (brief: string) => void
  onStart: () => Promise<unknown>
  onCancel: (taskId: string) => Promise<unknown>
  onRetry: (taskId: string) => Promise<unknown>
  onSave: (taskId: string) => Promise<unknown>
  onDiscard: (taskId: string) => Promise<unknown>
  t: TFunction<"evals">
}) {
  const canOpenResult = Boolean(task?.draftId)
  const active = task ? isActiveEvalGeneration(task.status) : false
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  )

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-dvh w-[min(62rem,92vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 border-l border-border-strong bg-background p-0 shadow-2xl sm:max-w-none"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-border-strong px-7 py-5 pr-14">
          <div className="ui-label text-signal-dark">
            {creating ? t("drawer.createEyebrow") : t("drawer.detailEyebrow")}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle className="text-xl">
              {creating
                ? t("drawer.createTitle")
                : task?.target.sourceKind === "DRAFT_REVISION"
                  ? t("table.draftVersion", {
                      version: task.target.displayVersion,
                    })
                  : task?.target.displayVersion}
            </DialogTitle>
            {!creating && task ? (
              <span className="border border-border-default px-2 py-1 font-mono text-xs font-bold">
                {t(`status.${task.status}`)}
              </span>
            ) : null}
          </div>
          <DialogDescription className="text-sm leading-6">
            {creating
              ? t("drawer.createDescription")
              : t("drawer.detailDescription")}
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <GenerationSetup
            generationBlocked={generationBlocked}
            generationBrief={generationBrief}
            maxEvalCount={maxEvalCount}
            onBriefChange={onBriefChange}
            onCountChange={onCountChange}
            onStart={onStart}
            onTargetChange={onTargetChange}
            pending={pending}
            selectedTargetKey={selectedTargetKey}
            t={t}
            targetOptions={targetOptions}
          />
        ) : task ? (
          <>
            <div
              aria-label={t("drawer.tabsLabel")}
              className="flex shrink-0 border-b border-border-strong bg-paper-muted px-5"
              role="tablist"
            >
              {(["process", "result"] as const).map((item) => {
                const disabled = item === "result" && !canOpenResult
                return (
                  <button
                    aria-controls={`eval-drawer-${item}`}
                    aria-selected={tab === item}
                    className={cn(
                      "border-x border-transparent border-b-2 px-5 py-3 font-mono text-xs font-bold",
                      tab === item
                        ? "border-b-primary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      disabled && "cursor-not-allowed opacity-45",
                    )}
                    disabled={disabled}
                    id={`eval-drawer-tab-${item}`}
                    key={item}
                    onClick={() => onTabChange(item)}
                    role="tab"
                    type="button"
                  >
                    {t(`drawer.tabs.${item}`)}
                    {item === "result" && task.draftStatus ? (
                      <span className="ml-2 border border-status-passed/50 px-1.5 py-0.5 text-[11px] leading-4 text-status-passed">
                        {t(`table.reviewStatus.${task.draftStatus}`)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div
              aria-labelledby={`eval-drawer-tab-${tab}`}
              className="min-h-0 flex-1 overflow-hidden"
              id={`eval-drawer-${tab}`}
              role="tabpanel"
            >
              {tab === "process" ? (
                <EvalGenerationProgress
                  events={events}
                  task={task}
                  t={t}
                />
              ) : (
                <EvalDraftReview
                  draft={draft}
                  loading={draftLoading}
                  t={t}
                  task={task}
                />
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-strong bg-surface-muted px-6 py-3">
              <div className="text-sm text-muted-foreground">
                {draft?.status === "PUBLISHED" ? (
                  <span className="flex items-center gap-2 font-semibold text-status-passed">
                    <CheckCircle2 className="size-4" />
                    {task.revisionNumber
                      ? t("drawer.savedRevision", {
                          revision: task.revisionNumber,
                        })
                      : t("save.status.PUBLISHED")}
                  </span>
                ) : draft?.status === "DISCARDED" ? (
                  t("save.status.DISCARDED")
                ) : tab === "result" && draft ? (
                  t("drawer.reviewBeforeSave")
                ) : (
                  t("drawer.closeHint")
                )}
              </div>
              <div className="flex gap-2">
                {draft?.status === "PUBLISHED" &&
                savedRevisionId ? (
                  <Button asChild className="rounded-none">
                    <Link
                      to={`/workbenches/${workspaceId}/runs?evalRevisionId=${encodeURIComponent(savedRevisionId)}`}
                    >
                      <Play data-icon="inline-start" />
                      {t("save.runTest")}
                    </Link>
                  </Button>
                ) : null}
                {active ? (
                  <Button
                    className="rounded-none"
                    disabled={pending}
                    onClick={() => {
                      void onCancel(task.id).catch(() => undefined)
                    }}
                    type="button"
                    variant="outline"
                  >
                    <Square data-icon="inline-start" />
                    {t("controls.cancel")}
                  </Button>
                ) : null}
                {task.status === "FAILED" ? (
                  <Button
                    className="rounded-none"
                    disabled={pending || generationBlocked}
                    onClick={() => {
                      void onRetry(task.id).catch(() => undefined)
                    }}
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw data-icon="inline-start" />
                    {t("controls.retry")}
                  </Button>
                ) : null}
                {tab === "result" && draft?.status === "READY" ? (
                  <>
                    <Button
                      className="rounded-none"
                      disabled={pending}
                      onClick={() => {
                        setConfirmation({
                          title: t("save.discardTitle"),
                          description: t("save.discardConfirm"),
                          confirmLabel: t("save.discard"),
                          confirmVariant: "destructive",
                          onConfirm: () => onDiscard(task.id),
                        })
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Ban data-icon="inline-start" />
                      {t("save.discard")}
                    </Button>
                    <Button
                      className="rounded-none"
                      disabled={pending}
                      onClick={() => {
                        setConfirmation({
                          title: t("save.confirmTitle"),
                          description: t("save.confirm"),
                          confirmLabel: t("save.action"),
                          confirmVariant: "default",
                          onConfirm: () => onSave(task.id),
                        })
                      }}
                      type="button"
                    >
                      <FileCheck2 data-icon="inline-start" />
                      {t("save.action")}
                    </Button>
                  </>
                ) : null}
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("drawer.loadingTask")}
          </div>
        )}
      </DialogContent>
      </Dialog>
      <ConfirmationDialog
        cancelLabel={t("controls.cancel")}
        confirmLabel={confirmation?.confirmLabel ?? ""}
        confirmVariant={confirmation?.confirmVariant}
        description={confirmation?.description ?? ""}
        onConfirm={() => confirmation?.onConfirm()}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmation(null)
        }}
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
      />
    </>
  )
}
