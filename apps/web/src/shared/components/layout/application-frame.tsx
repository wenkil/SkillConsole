import type { ReactNode } from "react"

interface ApplicationFrameProps {
  sidebar: ReactNode
  children: ReactNode
}

export function ApplicationFrame({
  sidebar,
  children,
}: ApplicationFrameProps) {
  return (
    <div className="grid min-h-[calc(100vh-var(--app-header-height))] grid-cols-[var(--project-sidebar-width)_minmax(0,1fr)] border-x border-b border-foreground">
      {sidebar}
      {children}
    </div>
  )
}
