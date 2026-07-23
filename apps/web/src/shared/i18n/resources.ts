import enCommon from "@/locales/en/common.json"
import enWorkbenchHome from "@/locales/en/workbench-home.json"
import zhCommon from "@/locales/zh-CN/common.json"
import zhWorkbenchHome from "@/locales/zh-CN/workbench-home.json"

export const defaultNamespace = "common"

export const resources = {
  en: {
    common: enCommon,
    workbenchHome: enWorkbenchHome,
  },
  "zh-CN": {
    common: zhCommon,
    workbenchHome: zhWorkbenchHome,
  },
} as const
