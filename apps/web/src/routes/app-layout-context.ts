import { createContext, useContext } from "react"

import type { WorkbenchHomeController } from "@/features/workbench-home/hooks/use-workbench-home-controller"

export interface AppLayoutContextValue {
  controller: WorkbenchHomeController
}

export const AppLayoutContext =
  createContext<AppLayoutContextValue | null>(null)

export function useAppLayoutContext(): AppLayoutContextValue {
  const context = useContext(AppLayoutContext)
  if (!context) {
    throw new Error("App layout context is unavailable.")
  }
  return context
}
