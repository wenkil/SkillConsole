import {
  Activity,
  ArrowLeft,
  FileChartColumn,
  FlaskConical,
  FolderOpen,
  Home,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink } from "react-router-dom"
import { Tooltip } from "radix-ui"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/shared/lib/utils"

export type WorkspaceModule =
  | "overview"
  | "versions"
  | "test-cases"
  | "datasets"
  | "runs"
  | "reports"

interface WorkspaceNavigationProps {
  workspace: SkillWorkspace
  activeModule: WorkspaceModule
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

interface NavigationItem {
  module: WorkspaceModule
  label: string
  path: string
  icon: LucideIcon
  end?: boolean
}

function getWorkspaceState(
  workspace: SkillWorkspace,
  workingCopy: string,
  noFormalVersion: string,
): string {
  if (workspace.activeDraft) {
    return workingCopy
  }

  return workspace.onlineVersion
    ? workspace.onlineVersion.name
    : noFormalVersion
}

function CollapsedTooltip({
  children,
  label,
}: {
  children: React.ReactElement
  label: string
}) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 rounded-lg border border-border bg-foreground px-3 py-2 text-xs font-semibold text-background shadow-lg"
          side="right"
          sideOffset={8}
        >
          {label}
          <Tooltip.Arrow className="fill-foreground" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function WorkspaceNavigation({
  workspace,
  activeModule,
  collapsed,
  onCollapsedChange,
}: WorkspaceNavigationProps) {
  const { t } = useTranslation("workbenchHome")
  const basePath = `/workbenches/${workspace.id}`
  const items: NavigationItem[] = [
    {
      module: "overview",
      label: t("workspaceShell.navigation.overview"),
      path: basePath,
      icon: Home,
      end: true,
    },
    {
      module: "versions",
      label: t("workspaceShell.navigation.versions"),
      path: `${basePath}/versions`,
      icon: Layers3,
    },
    {
      module: "test-cases",
      label: t("workspaceShell.navigation.testCases"),
      path: `${basePath}/test-cases`,
      icon: FlaskConical,
    },
    {
      module: "runs",
      label: t("workspaceShell.navigation.runs"),
      path: `${basePath}/runs`,
      icon: Activity,
    },
    {
      module: "reports",
      label: t("workspaceShell.navigation.reports", {
        defaultValue: "Test reports",
      }),
      path: `${basePath}/reports`,
      icon: FileChartColumn,
    },
  ]
  const workspaceState = getWorkspaceState(
    workspace,
    t("workspaceShell.workingCopy", {
      defaultValue: "Working copy · continuously saved",
    }),
    t("workspaceShell.noFormalVersion"),
  )

  return (
    <Tooltip.Provider>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
        <div
          className={cn(
            "shrink-0 border-b border-border-subtle",
            collapsed ? "p-2" : "p-5",
          )}
        >
          {collapsed ? (
            <CollapsedTooltip label={workspace.name}>
              <div
                aria-label={`${workspace.name} · ${workspaceState}`}
                className="flex h-11 items-center justify-center rounded-xl border border-border bg-card"
                role="img"
              >
                <FolderOpen
                  aria-hidden="true"
                  className="size-5 text-primary"
                />
              </div>
            </CollapsedTooltip>
          ) : (
            <div className="rounded-xl border border-border bg-card px-3.5 py-3.5 shadow-[var(--surface-shadow-soft)]">
              <div className="flex min-w-0 items-center gap-2.5">
                <FolderOpen
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <strong className="truncate text-sm leading-5">
                  {workspace.name}
                </strong>
              </div>
              <span className="mt-1.5 block truncate pl-7.5 text-xs leading-5 text-muted-foreground">
                {workspaceState}
              </span>
            </div>
          )}
        </div>

        <nav
          aria-label={t("workspaceShell.navigation.label")}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            collapsed ? "px-2 py-3" : "px-4 py-5",
          )}
        >
          {!collapsed ? (
            <div className="ui-label mb-2 px-2 pb-2">
              {t("workspaceShell.navigation.label")}
            </div>
          ) : null}

          <div className="grid gap-1">
            {items.map((item) => {
              const Icon = item.icon
              const link = (
                <NavLink
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn(
                      "relative flex h-11 items-center rounded-xl border border-transparent text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      collapsed
                        ? "justify-center px-0"
                        : "gap-3 px-3",
                      (isActive || activeModule === item.module) &&
                        "bg-accent font-semibold text-accent-foreground",
                    )
                  }
                  {...(item.end ? { end: true } : {})}
                  to={item.path}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-[18px] shrink-0",
                      activeModule === item.module
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                  />
                  {!collapsed ? <span>{item.label}</span> : null}
                </NavLink>
              )

              return collapsed ? (
                <CollapsedTooltip key={item.module} label={item.label}>
                  {link}
                </CollapsedTooltip>
              ) : (
                <div key={item.module}>{link}</div>
              )
            })}
          </div>
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border-subtle",
            collapsed ? "grid gap-2 p-2" : "p-4",
          )}
        >
          {collapsed ? (
            <CollapsedTooltip label={t("workspaceShell.backToList")}>
              <NavLink
                aria-label={t("workspaceShell.backToList")}
                className="flex h-10 items-center justify-center rounded-xl border border-transparent hover:bg-accent"
                to="/"
              >
                <ArrowLeft aria-hidden="true" className="size-[18px]" />
              </NavLink>
            </CollapsedTooltip>
          ) : (
            <NavLink
              className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              to="/"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t("workspaceShell.backToList")}
            </NavLink>
          )}

          <Button
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? t("workspaceShell.expandSidebar")
                : t("workspaceShell.collapseSidebar")
            }
            className={cn(
              "mt-2 h-10 rounded-xl border-border bg-card shadow-none",
              collapsed ? "w-full px-0" : "w-full justify-start px-3",
            )}
            onClick={() => onCollapsedChange(!collapsed)}
            type="button"
            variant="outline"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <>
                <PanelLeftClose
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                {t("workspaceShell.collapseSidebar")}
              </>
            )}
          </Button>

        </div>
      </aside>
    </Tooltip.Provider>
  )
}
