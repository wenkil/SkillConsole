import enCommon from "@/locales/en/common.json"
import enEvals from "@/locales/en/evals.json"
import enTestRuns from "@/locales/en/test-runs.json"
import enTestReports from "@/locales/en/test-reports.json"
import enVersionBrowser from "@/locales/en/version-browser.json"
import enWorkbenchHome from "@/locales/en/workbench-home.json"
import zhCommon from "@/locales/zh-CN/common.json"
import zhEvals from "@/locales/zh-CN/evals.json"
import zhTestRuns from "@/locales/zh-CN/test-runs.json"
import zhTestReports from "@/locales/zh-CN/test-reports.json"
import zhVersionBrowser from "@/locales/zh-CN/version-browser.json"
import zhWorkbenchHome from "@/locales/zh-CN/workbench-home.json"

export const defaultNamespace = "common"

export const resources = {
  en: {
    common: enCommon,
    evals: enEvals,
    testRuns: enTestRuns,
    testReports: enTestReports,
    versionBrowser: enVersionBrowser,
    workbenchHome: enWorkbenchHome,
  },
  "zh-CN": {
    common: zhCommon,
    evals: zhEvals,
    testRuns: zhTestRuns,
    testReports: zhTestReports,
    versionBrowser: zhVersionBrowser,
    workbenchHome: zhWorkbenchHome,
  },
} as const
