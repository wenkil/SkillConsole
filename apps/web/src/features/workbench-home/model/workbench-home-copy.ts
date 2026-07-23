import type { TFunction } from "i18next"

export interface WorkbenchHomeCopy {
  settings: string
  workbenches: string
  projectList: string
  emptyTitle: string
  emptyDescription: string
  eyebrow: string
  heroTitle: string
  heroDescription: string
  createWorkbench: string
  initialization: string
  setupDescription: string
  steps: Array<{
    title: string
    description: string
  }>
  localFirstTitle: string
  localFirstDescription: string
  createDialogTitle: string
  workbenchName: string
  workbenchNamePlaceholder: string
  workbenchNameHelp: string
  skillSource: string
  folder: string
  folderDescription: string
  zip: string
  zipDescription: string
  chooseFolder: string
  chooseZip: string
  dropHint: string
  selectedSource: string
  cancel: string
  createProject: string
  nameRequired: string
  sourceRequired: string
  settingsDialogTitle: string
  settingsDescription: string
  endpointUrl: string
  apiKey: string
  modelId: string
  saveSettings: string
  projectCreated: string
  settingsSaved: string
  backToHome: string
  detailPlaceholder: string
}

export function getWorkbenchHomeCopy(
  translateCommon: TFunction<"common">,
  translate: TFunction<"workbenchHome">,
): WorkbenchHomeCopy {
  return {
    settings: translateCommon("actions.settings"),
    workbenches: translate("sidebar.workbenches"),
    projectList: translate("sidebar.projectList"),
    emptyTitle: translate("sidebar.emptyTitle"),
    emptyDescription: translate("sidebar.emptyDescription"),
    eyebrow: translate("hero.eyebrow"),
    heroTitle: translate("hero.title"),
    heroDescription: translate("hero.description"),
    createWorkbench: translate("hero.createWorkbench"),
    initialization: translate("setup.title"),
    setupDescription: translate("setup.description"),
    steps: [
      {
        title: translate("setup.steps.name.title"),
        description: translate("setup.steps.name.description"),
      },
      {
        title: translate("setup.steps.source.title"),
        description: translate("setup.steps.source.description"),
      },
      {
        title: translate("setup.steps.runtime.title"),
        description: translate("setup.steps.runtime.description"),
      },
      {
        title: translate("setup.steps.validate.title"),
        description: translate("setup.steps.validate.description"),
      },
    ],
    localFirstTitle: translate("localFirst.title"),
    localFirstDescription: translate("localFirst.description"),
    createDialogTitle: translate("createDialog.title"),
    workbenchName: translate("createDialog.workbenchName"),
    workbenchNamePlaceholder: translate(
      "createDialog.workbenchNamePlaceholder",
    ),
    workbenchNameHelp: translate("createDialog.workbenchNameHelp"),
    skillSource: translate("createDialog.skillSource"),
    folder: translate("createDialog.folder"),
    folderDescription: translate("createDialog.folderDescription"),
    zip: translate("createDialog.zip"),
    zipDescription: translate("createDialog.zipDescription"),
    chooseFolder: translate("createDialog.chooseFolder"),
    chooseZip: translate("createDialog.chooseZip"),
    dropHint: translate("createDialog.dropHint"),
    selectedSource: translate("createDialog.selectedSource"),
    cancel: translate("createDialog.cancel"),
    createProject: translate("createDialog.createProject"),
    nameRequired: translate("createDialog.nameRequired"),
    sourceRequired: translate("createDialog.sourceRequired"),
    settingsDialogTitle: translate("settingsDialog.title"),
    settingsDescription: translate("settingsDialog.description"),
    endpointUrl: translate("settingsDialog.endpointUrl"),
    apiKey: translate("settingsDialog.apiKey"),
    modelId: translate("settingsDialog.modelId"),
    saveSettings: translate("settingsDialog.saveSettings"),
    projectCreated: translate("notifications.projectCreated"),
    settingsSaved: translate("notifications.settingsSaved"),
    backToHome: translate("detail.backToHome"),
    detailPlaceholder: translate("detail.placeholder"),
  }
}
