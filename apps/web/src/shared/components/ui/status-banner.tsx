import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

const variantClasses = {
  info: "border-technical/50 bg-technical/6 text-foreground",
  error: "border-destructive/55 bg-destructive/6 text-destructive",
  warning: "border-status-blocked/55 bg-status-blocked/6 text-status-blocked",
} as const

export function StatusBanner({
  icon: Icon,
  children,
  action,
  variant = "info",
  className,
}: {
  icon: LucideIcon
  children: ReactNode
  action?: ReactNode
  variant?: keyof typeof variantClasses
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border px-5 py-3 text-sm",
        variantClasses[variant],
        className,
      )}
      role={variant === "error" ? "alert" : "status"}
    >
      <span className="flex min-w-0 items-center gap-2 break-words">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0">{children}</span>
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  )
}
