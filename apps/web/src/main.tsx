import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@/styles/globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app/App"
import { AppProviders } from "@/app/providers/AppProviders"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("SkillConsole root element was not found.")
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
