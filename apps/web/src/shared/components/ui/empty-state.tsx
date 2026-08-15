import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center p-8 text-center",
        className,
      )}
    >
      <div className="max-w-md">
        <div className="mx-auto flex size-12 items-center justify-center border border-border-default bg-surface-muted text-technical">
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.7} />
        </div>
        <h2 className="mt-4 text-lg leading-6 font-semibold">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  )
}
