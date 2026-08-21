import { FolderPlus, Gauge } from "lucide-react"

import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { WorkbenchSetupGuide } from "@/features/workbench-home/components/workbench-setup-guide"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchHomeViewProps {
  copy: WorkbenchHomeCopy
  onCreateWorkbench: () => void
}

export function WorkbenchHomeView({
  copy,
  onCreateWorkbench,
}: WorkbenchHomeViewProps) {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
      <section className="border-b border-border pb-7">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Gauge aria-hidden="true" className="size-3.5" />
          {copy.eyebrow}
        </div>

        <h1 className="max-w-4xl font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.08] font-bold tracking-[-0.035em]">
          {copy.heroTitle}
        </h1>

        <div className="mt-4 flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
          <p className="max-w-3xl flex-1 text-sm leading-6 text-muted-foreground">
            {copy.heroDescription}
          </p>
          <Button
            className="h-10 shrink-0 px-5"
            onClick={onCreateWorkbench}
            type="button"
          >
            <FolderPlus aria-hidden="true" data-icon="inline-start" />
            {copy.createWorkbench}
          </Button>
        </div>
      </section>

      <WorkbenchSetupGuide copy={copy} />
    </main>
  )
}
