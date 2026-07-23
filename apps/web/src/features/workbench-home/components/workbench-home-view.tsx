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
    <main className="min-w-0 px-10 py-9">
      <section className="border-b border-rule pb-7">
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.08em] text-signal-dark uppercase">
          <Gauge aria-hidden="true" className="size-3.5" />
          {copy.eyebrow}
        </div>

        <h1 className="text-[clamp(2.25rem,3.5vw,3.45rem)] leading-[1.04] font-[780] tracking-[-0.045em]">
          {copy.heroTitle}
        </h1>

        <div className="mt-4 flex items-center justify-between gap-8">
          <p className="max-w-3xl flex-1 text-[15px] leading-relaxed text-muted-foreground">
            {copy.heroDescription}
          </p>
          <Button
            className="h-10 shrink-0 rounded-none px-5 font-bold shadow-none"
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
