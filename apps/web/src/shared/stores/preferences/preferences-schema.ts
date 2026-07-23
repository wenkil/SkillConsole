import { z } from "zod"

import { supportedLocales } from "@/shared/i18n/locale"

export const persistedPreferencesSchema = z.object({
  locale: z.enum(supportedLocales),
})

export type PersistedPreferences = z.infer<
  typeof persistedPreferencesSchema
>
