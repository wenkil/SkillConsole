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
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-stretch gap-0 border-y border-border",
        className,
      )}
    >
      {items.map((item, index) => (
        <div className="relative min-w-[10rem] flex-1 bg-background px-4 py-3 first:pl-0 after:absolute after:top-3 after:right-0 after:h-8 after:w-px after:bg-border last:after:hidden" key={index}>
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
