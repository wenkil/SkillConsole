import {
  Activity,
  ArrowLeft,
  Database,
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
          className="z-50 border border-foreground bg-foreground px-2.5 py-1.5 text-[11px] font-semibold text-background shadow-sm"
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
      module: "datasets",
      label: t("workspaceShell.navigation.datasets"),
      path: `${basePath}/datasets`,
      icon: Database,
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
        defaultValue: "Comparison reports",
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
      <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-foreground bg-sidebar">
        <div
          className={cn(
            "shrink-0 border-b border-rule-soft",
            collapsed ? "p-2" : "p-5",
          )}
        >
          {collapsed ? (
            <CollapsedTooltip label={workspace.name}>
              <div
                aria-label={`${workspace.name} · ${workspaceState}`}
                className="flex h-11 items-center justify-center border border-rule bg-paper-raised"
                role="img"
              >
                <FolderOpen
                  aria-hidden="true"
                  className="size-5 text-primary"
                />
              </div>
            </CollapsedTooltip>
          ) : (
            <div className="border border-rule bg-paper-raised px-3.5 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <FolderOpen
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <strong className="truncate text-[13px]">
                  {workspace.name}
                </strong>
              </div>
              <span className="mt-1.5 block truncate pl-7.5 font-mono text-[11px] text-muted-foreground">
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
            <div className="mb-3 border-b border-rule-soft px-2 pb-2 font-mono text-[11px] tracking-[0.05em] text-muted-foreground uppercase">
              {t("workspaceShell.navigation.label")}
            </div>
          ) : null}

          <div className="grid gap-1.5">
            {items.map((item) => {
              const Icon = item.icon
              const link = (
                <NavLink
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn(
                      "relative flex h-11 items-center border border-transparent font-semibold transition-colors hover:border-rule hover:bg-accent",
                      collapsed
                        ? "justify-center px-0"
                        : "gap-3 px-3 text-[13px]",
                      (isActive || activeModule === item.module) &&
                        "border-primary bg-accent text-signal-dark shadow-[inset_3px_0_0_var(--primary)]",
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
                        : "text-foreground",
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
            "shrink-0 border-t border-rule-soft",
            collapsed ? "grid gap-2 p-2" : "p-4",
          )}
        >
          {collapsed ? (
            <CollapsedTooltip label={t("workspaceShell.backToList")}>
              <NavLink
                aria-label={t("workspaceShell.backToList")}
                className="flex h-10 items-center justify-center border border-transparent hover:border-rule hover:bg-accent"
                to="/"
              >
                <ArrowLeft aria-hidden="true" className="size-[18px]" />
              </NavLink>
            </CollapsedTooltip>
          ) : (
            <NavLink
              className="flex h-10 items-center gap-2.5 px-3 text-[13px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
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
              "mt-2 h-10 rounded-none border-rule bg-paper-raised shadow-none",
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
