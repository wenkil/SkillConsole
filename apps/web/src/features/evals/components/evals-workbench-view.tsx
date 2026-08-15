import {
  AlertTriangle,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { EvalTaskDrawer } from "@/features/evals/components/eval-task-drawer"
import { EvalTaskTable } from "@/features/evals/components/eval-task-table"
import { useEvalsController } from "@/features/evals/hooks/use-evals-controller"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

export function EvalsWorkbenchView({
  workspace,
  locale,
}: {
  workspace: SkillWorkspace
  locale: string
}) {
  const { t } = useTranslation("evals")
  const controller = useEvalsController(workspace)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [drawerTab, setDrawerTab] = useState<"process" | "result">("process")

  if (controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.loading")}
      </main>
    )
  }
  if (controller.error) {
    return (
      <main className="flex h-full items-center justify-center px-8">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-[760]">
            {t("states.loadError")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("states.loadErrorDescription")}
          </p>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw data-icon="inline-start" />
            {t("states.retry")}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              <Sparkles className="size-3.5" />
              {t("header.eyebrow")}
            </div>
            <h1 className="mt-1.5 text-3xl leading-none font-[790] tracking-[-0.04em]">
              {t("header.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t("header.description", { name: workspace.name })}
            </p>
          </div>
          <div className="grid grid-cols-3 border border-foreground bg-rule gap-px">
            <div className="min-w-24 bg-background px-3 py-2">
              <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                {t("header.metrics.tasks")}
              </span>
              <strong className="mt-0.5 block text-lg">
                {controller.taskSummary.total}
              </strong>
            </div>
            <div className="min-w-24 bg-background px-3 py-2">
              <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                {t("header.metrics.review")}
              </span>
              <strong className="mt-0.5 block text-lg">
                {controller.taskSummary.awaitingReview}
              </strong>
            </div>
            <div className="min-w-24 bg-background px-3 py-2">
              <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                {t("header.metrics.saved")}
              </span>
              <strong className="mt-0.5 block text-lg">
                {controller.taskSummary.published}
              </strong>
            </div>
          </div>
        </div>
      </header>

      {controller.mutationError ? (
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/50 bg-destructive/5 px-5 py-2 text-xs"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            {controller.mutationError}
          </span>
          <button
            className="font-mono text-[10px] underline"
            onClick={controller.actions.clearMutationError}
            type="button"
          >
            {t("states.dismiss")}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <EvalTaskTable
          locale={locale}
          onGenerate={() => {
            setCreating(true)
            setDrawerTab("process")
            setDrawerOpen(true)
          }}
          onOpen={(taskId) => {
            const task = controller.tasks.find((item) => item.id === taskId)
            controller.actions.selectTask(taskId)
            setCreating(false)
            setDrawerTab(task?.draftId ? "result" : "process")
            setDrawerOpen(true)
          }}
          onPageChange={controller.actions.setPage}
          onPageSizeChange={controller.actions.setPageSize}
          page={controller.taskPagination.page}
          pageCount={controller.taskPagination.pageCount}
          pageSize={controller.taskPagination.pageSize}
          t={t}
          tasks={controller.tasks}
          total={controller.taskPagination.total}
        />
      </div>

      <EvalTaskDrawer
        creating={creating}
        savedRevisionId={
          controller.revisions.find(
            (revision) =>
              revision.sourceGenerationTaskId ===
              controller.selectedTask?.id,
          )?.id ?? null
        }
        draft={controller.selectedDraft}
        failureSummary={controller.failureSummary}
        draftLoading={controller.draftLoading}
        events={controller.events}
        generationBlocked={controller.taskSummary.running > 0}
        generationBrief={controller.generationBrief}
        maxEvalCount={controller.maxEvalCount}
        onBriefChange={controller.actions.setGenerationBrief}
        onCancel={controller.actions.cancel}
        onCountChange={controller.actions.setMaxEvalCount}
        onDiscard={controller.actions.discard}
        onOpenChange={setDrawerOpen}
        onSave={controller.actions.save}
        onStart={async () => {
          const task = await controller.actions.start()
          setCreating(false)
          return task
        }}
        onTargetChange={controller.actions.selectTarget}
        open={drawerOpen}
        pending={controller.mutationPending}
        selectedTargetKey={controller.selectedTargetKey}
        tab={drawerTab}
        t={t}
        targetOptions={controller.targetOptions}
        task={controller.selectedTask}
        workspaceId={workspace.id}
        onTabChange={setDrawerTab}
      />

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-foreground bg-paper-muted px-5 font-mono text-[9px] text-muted-foreground uppercase">
        <span className="flex items-center gap-1.5">
          <Layers3 className="size-3" />
          {t("footer.snapshotBoundary")}
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3 text-status-passed" />
          {t("footer.saveBoundary")}
        </span>
      </footer>
    </main>
  )
}
