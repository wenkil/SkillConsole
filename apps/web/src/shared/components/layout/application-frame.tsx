import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

interface ApplicationFrameProps {
  sidebar?: ReactNode
  children: ReactNode
}

export function ApplicationFrame({
  sidebar,
  children,
}: ApplicationFrameProps) {
  return (
    <div
      className={cn(
        "grid h-[calc(100dvh-var(--app-header-height))] min-h-0 overflow-hidden border-x border-b border-foreground",
        sidebar
          ? "grid-cols-[var(--workbench-sidebar-width)_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)]",
      )}
    >
      {sidebar}
      {children}
    </div>
  )
}
