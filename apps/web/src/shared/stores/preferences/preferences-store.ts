import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import { resolveBrowserLocale } from "@/shared/i18n/locale"
import {
  persistedPreferencesSchema,
  type PersistedPreferences,
} from "@/shared/stores/preferences/preferences-schema"
import type { AppLocale } from "@/shared/types/locale"

interface PreferencesState extends PersistedPreferences {
  setLocale: (locale: AppLocale) => void
  resetPreferences: () => void
}

const defaultPreferences: PersistedPreferences = {
  locale: resolveBrowserLocale(),
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...defaultPreferences,
      setLocale: (locale) => set({ locale }),
      resetPreferences: () => set(defaultPreferences),
    }),
    {
      name: "skillconsole:preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ locale }) => ({ locale }),
      migrate: (persistedState) => {
        const parsed = persistedPreferencesSchema.safeParse(persistedState)
        return parsed.success ? parsed.data : defaultPreferences
      },
      merge: (persistedState, currentState) => {
        const parsed = persistedPreferencesSchema.safeParse(persistedState)

        if (!parsed.success) {
          return currentState
        }

        return {
          ...currentState,
          ...parsed.data,
        }
      },
    },
  ),
)
