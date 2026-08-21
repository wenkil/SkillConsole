import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom"

import { AppLayoutRoute } from "@/routes/app-layout-route"
import { WorkbenchHomeRoute } from "@/routes/workbench-home-route"
import {
  EvalsWorkbenchRoute,
  TestRunDetailRoute,
  TestReportsWorkbenchRoute,
  TestRunsWorkbenchRoute,
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
            element={<VersionBrowserRoute comparison />}
            path="versions/compare"
          />
          <Route
            element={<VersionBrowserRoute />}
            path="versions/:versionId"
          />
          <Route
            element={<EvalsWorkbenchRoute />}
            path="test-cases"
          />
          <Route
            element={<Navigate replace relative="path" to=".." />}
            path="datasets"
          />
          <Route
            element={<TestRunsWorkbenchRoute />}
            path="runs"
          />
          <Route
            element={<TestRunDetailRoute />}
            path="runs/:runId"
          />
          <Route element={<TestReportsWorkbenchRoute />} path="reports" />
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
