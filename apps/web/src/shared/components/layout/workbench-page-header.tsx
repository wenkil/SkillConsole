import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

interface WorkbenchPageHeaderProps {
  eyebrow?: ReactNode
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  metrics?: ReactNode
  className?: string
}

export function WorkbenchPageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  metrics,
  className,
}: WorkbenchPageHeaderProps) {
  return (
    <header
      className={cn(
        "shrink-0 border-b border-border bg-background px-6 py-5 lg:px-8 lg:py-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              <span>{eyebrow}</span>
            </div>
          ) : null}
          <h1 className="mt-2 font-display text-[clamp(1.9rem,2.7vw,2.35rem)] leading-[1.18] font-bold tracking-[-0.025em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {metrics ? <div className="mt-5">{metrics}</div> : null}
    </header>
  )
}
