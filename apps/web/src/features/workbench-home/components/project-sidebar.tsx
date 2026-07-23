import { FolderDashed, FolderOpen, Layers3 } from "lucide-react"

import type { WorkbenchProject } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { TechnicalRuler } from "@/shared/components/layout/technical-ruler"
import { cn } from "@/shared/lib/utils"

interface ProjectSidebarProps {
  projects: WorkbenchProject[]
  activeProjectId: string | null
  copy: WorkbenchHomeCopy
  onProjectSelect: (projectId: string) => void
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  copy,
  onProjectSelect,
}: ProjectSidebarProps) {
  return (
    <aside className="relative flex min-h-[calc(100vh-var(--app-header-height)-2px)] flex-col border-r border-foreground bg-sidebar">
      <TechnicalRuler orientation="vertical" />

      <div className="flex min-h-full flex-1 flex-col px-5 pt-6 pb-5 pl-9">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="technical-heading text-[13px]">{copy.workbenches}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {String(projects.length).padStart(2, "0")}
          </span>
        </div>

        <div className="mb-2 flex items-center gap-2 border-b border-rule-soft pb-2.5 font-mono text-[11px] tracking-[0.05em] text-muted-foreground uppercase">
          <Layers3 aria-hidden="true" className="size-3.5" />
          {copy.projectList}
        </div>

        {projects.length === 0 ? (
          <div className="mt-2 border border-dashed border-rule px-3 py-7 text-center text-muted-foreground">
            <FolderDashed
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
            {projects.map((project) => (
              <button
                className={cn(
                  "w-full border border-rule-soft px-3 py-3 text-left transition-colors hover:border-primary hover:bg-accent",
                  activeProjectId === project.id &&
                    "border-primary bg-accent shadow-[inset_3px_0_0_var(--primary)]",
                )}
                key={project.id}
                onClick={() => onProjectSelect(project.id)}
                type="button"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <FolderOpen
                    aria-hidden="true"
                    className="size-4 text-primary"
                  />
                  <span className="truncate">{project.name}</span>
                </span>
                <span className="mt-1.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {project.sourceName}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto border-t border-rule-soft pt-4 font-mono text-[10px] leading-relaxed text-muted-foreground uppercase">
          <div>SC–DOS–00</div>
          <div>REV 0.3.0</div>
        </div>
      </div>
    </aside>
  )
}
