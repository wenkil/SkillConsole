import enCommon from "@/locales/en/common.json"
import enEvals from "@/locales/en/evals.json"
import enVersionBrowser from "@/locales/en/version-browser.json"
import enWorkbenchHome from "@/locales/en/workbench-home.json"
import zhCommon from "@/locales/zh-CN/common.json"
import zhEvals from "@/locales/zh-CN/evals.json"
import zhVersionBrowser from "@/locales/zh-CN/version-browser.json"
import zhWorkbenchHome from "@/locales/zh-CN/workbench-home.json"

export const defaultNamespace = "common"

export const resources = {
  en: {
    common: enCommon,
    evals: enEvals,
    versionBrowser: enVersionBrowser,
    workbenchHome: enWorkbenchHome,
  },
  "zh-CN": {
    common: zhCommon,
    evals: zhEvals,
    versionBrowser: zhVersionBrowser,
    workbenchHome: zhWorkbenchHome,
  },
} as const
