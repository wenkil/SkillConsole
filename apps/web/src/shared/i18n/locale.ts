import type { AppLocale } from "@/shared/types/locale"

export const supportedLocales = ["en", "zh-CN"] as const satisfies readonly AppLocale[]
export const fallbackLocale: AppLocale = "en"

export function resolveBrowserLocale(
  browserLocale = globalThis.navigator?.language,
): AppLocale {
  if (browserLocale?.toLowerCase().startsWith("zh")) {
    return "zh-CN"
  }

  return fallbackLocale
}

export function isAppLocale(value: unknown): value is AppLocale {
  return supportedLocales.some((locale) => locale === value)
}
