import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import {
  defaultNamespace,
  resources,
} from "@/shared/i18n/resources"
import {
  fallbackLocale,
  supportedLocales,
} from "@/shared/i18n/locale"
import { usePreferencesStore } from "@/shared/stores/preferences/preferences-store"

const initialLocale = usePreferencesStore.getState().locale

void i18n.use(initReactI18next).init({
  defaultNS: defaultNamespace,
  fallbackLng: fallbackLocale,
  initAsync: false,
  interpolation: {
    escapeValue: false,
  },
  lng: initialLocale,
  ns: ["common", "workbenchHome"],
  react: {
    useSuspense: false,
  },
  resources,
  supportedLngs: [...supportedLocales],
})

export { i18n }
