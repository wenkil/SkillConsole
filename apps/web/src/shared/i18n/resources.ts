import enCommon from "@/locales/en/common.json"
import enVersionBrowser from "@/locales/en/version-browser.json"
import enWorkbenchHome from "@/locales/en/workbench-home.json"
import zhCommon from "@/locales/zh-CN/common.json"
import zhVersionBrowser from "@/locales/zh-CN/version-browser.json"
import zhWorkbenchHome from "@/locales/zh-CN/workbench-home.json"

export const defaultNamespace = "common"

export const resources = {
  en: {
    common: enCommon,
    versionBrowser: enVersionBrowser,
    workbenchHome: enWorkbenchHome,
  },
  "zh-CN": {
    common: zhCommon,
    versionBrowser: zhVersionBrowser,
    workbenchHome: zhWorkbenchHome,
  },
} as const
