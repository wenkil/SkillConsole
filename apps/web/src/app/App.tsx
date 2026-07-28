import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom"

import { AppLayoutRoute } from "@/routes/app-layout-route"
import { WorkbenchHomeRoute } from "@/routes/workbench-home-route"
import {
  ModulePlaceholderRoute,
  VersionBrowserRoute,
  WorkbenchOverviewRoute,
  WorkspaceFallbackRoute,
} from "@/routes/workspace-module-routes"
import { WorkspaceShellRoute } from "@/routes/workspace-shell-route"

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayoutRoute />}>
        <Route index element={<WorkbenchHomeRoute />} />
        <Route
          element={<WorkspaceShellRoute />}
          path="workbenches/:workspaceId"
        >
          <Route index element={<WorkbenchOverviewRoute />} />
          <Route element={<VersionBrowserRoute />} path="versions" />
          <Route
            element={<VersionBrowserRoute />}
            path="versions/:versionId"
          />
          <Route
            element={<ModulePlaceholderRoute module="test-cases" />}
            path="test-cases"
          />
          <Route
            element={<ModulePlaceholderRoute module="datasets" />}
            path="datasets"
          />
          <Route
            element={<ModulePlaceholderRoute module="runs" />}
            path="runs"
          />
          <Route element={<WorkspaceFallbackRoute />} path="*" />
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
