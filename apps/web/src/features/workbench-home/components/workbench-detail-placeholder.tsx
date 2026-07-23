import { ArrowLeft, PanelsTopLeft } from "lucide-react"

import type { WorkbenchProject } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchDetailPlaceholderProps {
  project: WorkbenchProject
  copy: WorkbenchHomeCopy
  onBack: () => void
}

export function WorkbenchDetailPlaceholder({
  project,
  copy,
  onBack,
}: WorkbenchDetailPlaceholderProps) {
  return (
    <main className="flex min-w-0 flex-col px-10 py-9">
      <Button
        className="self-start rounded-none px-0"
        onClick={onBack}
        type="button"
        variant="link"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        {copy.backToHome}
      </Button>

      <section className="technical-panel m-auto grid min-h-80 max-w-3xl place-items-center px-12 text-center">
        <div>
          <PanelsTopLeft
            aria-hidden="true"
            className="mx-auto size-12 text-primary"
            strokeWidth={1.7}
          />
          <h1 className="mt-5 text-4xl font-bold tracking-tight">
            {project.name}
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
            {copy.detailPlaceholder}
          </p>
        </div>
      </section>
    </main>
  )
}
