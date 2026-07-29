import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { I18nextProvider } from "react-i18next"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { I18nSynchronizer } from "@/app/providers/I18nSynchronizer"
import { useWorkbenchHomeController } from "@/features/workbench-home/hooks/use-workbench-home-controller"
import { i18n } from "@/shared/i18n/i18n"
import { usePreferencesStore } from "@/shared/stores/preferences/preferences-store"

vi.mock("@/features/workbench-home/api/skill-workspaces-api", () => ({
  createSkillWorkspace: vi.fn(),
  getUploadFolderIgnorePolicy: vi.fn(async () => ({})),
  listSkillWorkspaces: vi.fn(async () => []),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <I18nextProvider i18n={i18n}>
        <I18nSynchronizer />
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </I18nextProvider>
    )
  }
}

beforeEach(async () => {
  localStorage.clear()
  usePreferencesStore.setState({ locale: "zh-CN" })
  await i18n.changeLanguage("zh-CN")
})

describe("useWorkbenchHomeController", () => {
  it("rebuilds the workbench copy when the i18n language changes", async () => {
    const { result } = renderHook(
      () => useWorkbenchHomeController(null),
      { wrapper: createWrapper() },
    )

    expect(result.current.copy.overviewEyebrow).toBe("工作台概览")

    act(() => {
      result.current.actions.changeLocale("en")
    })

    await waitFor(() => {
      expect(result.current.copy.overviewEyebrow).toBe("Workbench overview")
      expect(result.current.copy.currentVersion).toBe("Current content")
    })
  })
})
