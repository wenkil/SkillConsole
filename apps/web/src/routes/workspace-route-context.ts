import { useOutletContext } from "react-router-dom"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { AppLocale } from "@/shared/types/locale"

export interface WorkspaceRouteContext {
  workspace: SkillWorkspace
  locale: AppLocale
}

export function useWorkspaceRouteContext(): WorkspaceRouteContext {
  return useOutletContext<WorkspaceRouteContext>()
}
