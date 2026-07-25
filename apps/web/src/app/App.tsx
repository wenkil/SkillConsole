import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom"

import { WorkbenchHomeRoute } from "@/routes/workbench-home-route"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<WorkbenchHomeRoute />} path="/" />
        <Route
          element={<WorkbenchHomeRoute />}
          path="/workbenches/:workspaceId"
        />
        <Route
          element={<WorkbenchHomeRoute />}
          path="/workbenches/:workspaceId/versions/:versionId"
        />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  )
}
