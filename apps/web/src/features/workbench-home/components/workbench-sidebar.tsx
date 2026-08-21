import {
  AlertTriangle,
  Folder,
  FolderOpen,
  Layers3,
  LoaderCircle,
  RotateCcw,
} from "lucide-react"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { TechnicalRuler } from "@/shared/components/layout/technical-ruler"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/shared/lib/utils"

interface WorkbenchSidebarProps {
  workspaces: SkillWorkspace[]
  activeWorkspaceId: string | null
  loading: boolean
  error: boolean
  copy: WorkbenchHomeCopy
  onWorkspaceSelect: (workspaceId: string) => void
  onRetry: () => void
}

export function WorkbenchSidebar({
  workspaces,
  activeWorkspaceId,
  loading,
  error,
  copy,
  onWorkspaceSelect,
  onRetry,
}: WorkbenchSidebarProps) {
  return (
    <aside className="relative flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
      <TechnicalRuler orientation="vertical" />

      <div className="flex h-full min-h-0 flex-1 flex-col px-5 pt-6 pb-5 pl-9">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="technical-heading text-[13px]">{copy.workbenches}</h2>
          <span className="ui-meta">
            {String(workspaces.length).padStart(2, "0")}
          </span>
        </div>

        <div className="ui-label mb-2 flex items-center gap-2 pb-2.5">
          <Layers3 aria-hidden="true" className="size-3.5" />
          {copy.workbenchList}
        </div>

        <div
          aria-label={copy.workbenchList}
          className="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          {loading ? (
            <div className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-8 text-xs text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {copy.loadingWorkbenches}
            </div>
          ) : error ? (
            <div className="mt-2 rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-5 text-center">
              <AlertTriangle
                aria-hidden="true"
                className="mx-auto mb-2 size-6 text-destructive"
              />
              <strong className="block text-[13px]">{copy.listErrorTitle}</strong>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {copy.listErrorDescription}
              </span>
              <Button
                className="mt-3 h-8 rounded-xl text-xs shadow-none"
                onClick={onRetry}
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {copy.retry}
              </Button>
            </div>
          ) : workspaces.length === 0 ? (
            <div className="mt-2 rounded-xl border border-dashed border-rule px-3 py-7 text-center text-muted-foreground">
              <Folder
                aria-hidden="true"
                className="mx-auto mb-2 size-7"
                strokeWidth={1.7}
              />
              <strong className="mb-1 block text-[13px] text-foreground">
                {copy.emptyTitle}
              </strong>
              <span className="text-xs leading-relaxed">
                {copy.emptyDescription}
              </span>
            </div>
          ) : (
            <div className="grid gap-2">
              {workspaces.map((workspace) => (
                <button
                  className={cn(
                    "w-full rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent",
                    activeWorkspaceId === workspace.id &&
                      "bg-accent text-accent-foreground",
                  )}
                  key={workspace.id}
                  onClick={() => onWorkspaceSelect(workspace.id)}
                  type="button"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <FolderOpen
                      aria-hidden="true"
                      className="size-4 text-primary"
                    />
                    <span className="truncate">{workspace.name}</span>
                  </span>
                  <span className="ui-meta mt-1.5 flex items-center justify-between gap-2">
                    <span className="truncate">
                      {workspace.activeDraft?.sourceName ??
                        workspace.onlineVersion?.sourceName ??
                        copy.noFormalVersion}
                    </span>
                    <span className="shrink-0">
                      {workspace.activeDraft
                        ? copy.initialCandidateStatus
                        : workspace.onlineVersion
                          ? workspace.onlineVersion.name
                          : copy.noFormalVersion}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
    </aside>
  )
}
