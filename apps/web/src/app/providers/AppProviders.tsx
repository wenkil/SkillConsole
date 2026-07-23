import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import type { PropsWithChildren } from "react"
import { I18nextProvider } from "react-i18next"

import { I18nSynchronizer } from "@/app/providers/I18nSynchronizer"
import { Toaster } from "@/shared/components/ui/sonner"
import { i18n } from "@/shared/i18n/i18n"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <I18nextProvider i18n={i18n}>
      <I18nSynchronizer />
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        forcedTheme="light"
      >
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster position="bottom-right" />
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  )
}
