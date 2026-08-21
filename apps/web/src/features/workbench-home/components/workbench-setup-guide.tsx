import {
  ArrowRight,
  FolderOpen,
  PackageCheck,
  Ruler,
  ScanSearch,
  ShieldCheck,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { TechnicalRuler } from "@/shared/components/layout/technical-ruler"
import { cn } from "@/shared/lib/utils"

interface WorkbenchSetupGuideProps {
  copy: WorkbenchHomeCopy
}

const stepIcons: LucideIcon[] = [
  Ruler,
  FolderOpen,
  ScanSearch,
  PackageCheck,
]

export function WorkbenchSetupGuide({ copy }: WorkbenchSetupGuideProps) {
  return (
    <section aria-labelledby="workbench-initialization" className="mt-8">
      <h2
        className="border-b border-border pb-3 text-base leading-6 font-semibold"
        id="workbench-initialization"
      >
        {copy.initialization}
      </h2>

      <p className="my-4 text-sm leading-relaxed text-muted-foreground">
        {copy.setupDescription}
      </p>

      <div className="technical-panel overflow-hidden">
        <TechnicalRuler orientation="horizontal" />
        <div className="grid grid-cols-2 xl:grid-cols-4">
          {copy.steps.map((step, index) => {
            const Icon = stepIcons[index] ?? ShieldCheck
            const isTechnicalStep = index >= 2

            return (
              <article
                className="relative min-h-56 border-r border-border-subtle px-5 py-6 last:border-r-0"
                key={step.title}
              >
                <span className="text-sm font-extrabold text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1.5 text-sm leading-5 font-semibold">
                  {step.title}
                </h3>
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "mt-5 size-10",
                    isTechnicalStep && "text-technical",
                  )}
                  strokeWidth={1.7}
                />
                <p className="mt-5 text-[13px] leading-5 text-muted-foreground">
                  {step.description}
                </p>
                {index < copy.steps.length - 1 && (
                  <span className="absolute top-[5.8rem] -right-2 z-10 hidden size-4 place-items-center rounded-full bg-paper-raised xl:grid">
                    <ArrowRight aria-hidden="true" className="size-3" />
                  </span>
                )}
              </article>
            )
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-4 rounded-2xl bg-technical/8 px-5 py-4">
        <ShieldCheck
          aria-hidden="true"
          className="size-8 text-technical"
          strokeWidth={1.7}
        />
        <div>
          <strong className="block text-technical-foreground">
            {copy.localFirstTitle}
          </strong>
          <span className="text-[13px] leading-5 text-muted-foreground">
            {copy.localFirstDescription}
          </span>
        </div>
      </div>
    </section>
  )
}
