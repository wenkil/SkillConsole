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
        "shrink-0 border-b border-border-strong bg-background px-6 py-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="ui-label flex items-center gap-2 text-signal-dark">
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              <span>{eyebrow}</span>
            </div>
          ) : null}
          <h1 className="mt-1.5 text-[clamp(1.75rem,2.5vw,2rem)] leading-tight font-[760] tracking-[-0.03em]">
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
