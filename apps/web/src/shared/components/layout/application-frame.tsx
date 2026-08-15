import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

interface ApplicationFrameProps {
  sidebar?: ReactNode
  sidebarCollapsed?: boolean
  children: ReactNode
}

export function ApplicationFrame({
  sidebar,
  sidebarCollapsed = false,
  children,
}: ApplicationFrameProps) {
  return (
    <div
      className={cn(
        "grid h-[calc(100dvh-var(--app-header-height))] min-h-0 min-w-0 overflow-hidden border-x border-b border-border-strong transition-[grid-template-columns]",
        sidebar
          ? sidebarCollapsed
            ? "grid-cols-[var(--workspace-nav-collapsed-width)_minmax(0,1fr)]"
            : "grid-cols-[var(--workbench-sidebar-width)_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)]",
      )}
    >
      {sidebar}
      {children}
    </div>
  )
}
