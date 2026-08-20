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
import { MetricStrip } from "@/shared/components/layout/metric-strip"
import { WorkbenchPageHeader } from "@/shared/components/layout/workbench-page-header"
import { Button } from "@/shared/components/ui/button"
import { StatusBanner } from "@/shared/components/ui/status-banner"

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
      <main className="flex h-full items-center justify-center gap-2 text-sm">
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
      <WorkbenchPageHeader
        description={t("header.description", { name: workspace.name })}
        eyebrow={t("header.eyebrow")}
        icon={Sparkles}
        metrics={
          <MetricStrip
            ariaLabel={t("header.title")}
            items={[
              {
                label: t("header.metrics.tasks"),
                value: controller.taskSummary.total,
              },
              {
                hint: t("table.reviewStatus.READY"),
                label: t("header.metrics.review"),
                value: controller.taskSummary.awaitingReview,
                tone: controller.taskSummary.awaitingReview
                  ? "warning"
                  : "default",
              },
              {
                hint: t("status.SUCCEEDED"),
                label: t("header.metrics.saved"),
                value: controller.taskSummary.published,
                tone: "technical",
              },
            ]}
          />
        }
        title={t("header.title")}
      />

      {controller.mutationError ? (
        <StatusBanner
          action={
            <button
              className="font-mono text-xs underline underline-offset-2"
              onClick={controller.actions.clearMutationError}
              type="button"
            >
              {t("states.dismiss")}
            </button>
          }
          icon={AlertTriangle}
          variant="error"
        >
          {controller.mutationError}
        </StatusBanner>
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
        onRetry={controller.actions.retryGeneration}
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

      <footer className="ui-meta flex h-9 shrink-0 items-center justify-between border-t border-border-strong bg-surface-muted px-5 uppercase">
        <span className="flex items-center gap-1.5">
          <Layers3 className="size-3.5" />
          {t("footer.snapshotBoundary")}
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-status-passed" />
          {t("footer.saveBoundary")}
        </span>
      </footer>
    </main>
  )
}
