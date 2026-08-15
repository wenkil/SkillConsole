import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

export interface MetricStripItem {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: "default" | "technical" | "warning" | "danger"
}

const toneClasses = {
  default: "text-foreground",
  technical: "text-technical-foreground",
  warning: "text-status-blocked",
  danger: "text-status-failed",
} as const

export function MetricStrip({
  items,
  ariaLabel,
  className,
}: {
  items: readonly MetricStripItem[]
  ariaLabel?: string
  className?: string
}) {
  const columns = items.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 xl:grid-cols-4"

  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "grid gap-px border border-border-strong bg-border-default",
        columns,
        className,
      )}
    >
      {items.map((item, index) => (
        <div className="min-w-0 bg-background px-4 py-3" key={index}>
          <span className="ui-label block">{item.label}</span>
          <strong
            className={cn(
              "mt-1 block truncate text-lg leading-6 font-semibold",
              toneClasses[item.tone ?? "default"],
            )}
          >
            {item.value}
          </strong>
          {item.hint ? (
            <span className="mt-1 block truncate text-xs leading-5 text-muted-foreground">
              {item.hint}
            </span>
          ) : null}
        </div>
      ))}
    </section>
  )
}
