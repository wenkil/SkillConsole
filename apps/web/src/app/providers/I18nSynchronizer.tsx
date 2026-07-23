import { useEffect } from "react"

import { i18n } from "@/shared/i18n/i18n"
import { usePreferencesStore } from "@/shared/stores/preferences/preferences-store"

export function I18nSynchronizer() {
  const locale = usePreferencesStore((state) => state.locale)

  useEffect(() => {
    document.documentElement.lang = locale

    if (i18n.resolvedLanguage !== locale) {
      void i18n.changeLanguage(locale)
    }
  }, [locale])

  return null
}
