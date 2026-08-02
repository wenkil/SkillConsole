import type { TFunction } from "i18next"

import type {
  CreateWorkbenchErrors,
  SkillSourceKind,
} from "@/features/workbench-home/model/workbench"

interface SourceKindCopy {
  label: string
  description: string
  choose: string
}

interface WorkbenchOverviewDashboardCopy {
  eyebrow: string
  description: string
  publishedVersion: (name: string) => string
  noPublishedVersion: string
  noPublishedVersionValue: string
  statusTitle: string
  currentPublishedVersion: string
  currentPublishedVersionHint: string
  savedVersions: string
  savedVersionsHint: string
  workingCopy: string
  recentUpdated: (date: string) => string
  createFromPublished: string
  revision: (revision: number) => string
  noActiveDraft: string
  continueEditingDraft: string
  viewSkillVersions: string
  compareVersions: string
  evidenceWorkspace: string
  futureIteration: string
  cards: {
    testCases: { title: string; description: string }
    datasets: { title: string; description: string }
    testRuns: { title: string; description: string }
    comparisonReports: { title: string; description: string }
  }
  versionTagsTitle: string
  versionTagsDescription: string
}

export interface WorkbenchHomeCopy {
  workbenches: string
  workbenchList: string
  loadingWorkbenches: string
  listErrorTitle: string
  listErrorDescription: string
  retry: string
  emptyTitle: string
  emptyDescription: string
  initialCandidateStatus: string
  noFormalVersion: string
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
  initialCandidate: string
  createDialogTitle: string
  createDialogDescription: string
  workbenchName: string
  workbenchNamePlaceholder: string
  workbenchNameHelp: string
  skillSource: string
  sourceScope: string
  sourceKinds: Record<SkillSourceKind, SourceKindCopy>
  dropHint: string
  preparingSource: string
  preparingSourceDescription: string
  uploadingSource: string
  uploadingSourceDescription: string
  loadingUploadPolicy: string
  uploadPolicyUnavailable: string
  importSummary: string
  readyForValidation: string
  sourceType: string
  fileCount: string
  totalSize: string
  directoryDepth: string
  serverValidationNote: string
  ignoredFolderFiles: (count: number) => string
  cancel: string
  createWorkbenchAndCandidate: string
  savingCandidate: string
  nameRequired: string
  sourceErrors: Record<
    NonNullable<CreateWorkbenchErrors["source"]>,
    string
  >
  createFailed: string
  fileCountExceeded: string
  unknownCreateError: string
  workspaceCreated: string
  backToHome: string
  overviewEyebrow: string
  overviewDescription: string
  versionState: string
  publishedWithoutTests: string
  candidateWithoutTests: string
  versionSummary: string
  currentVersion: string
  defaultBaseline: string
  v1DefaultBaseline: string
  notBaseline: string
  testState: string
  notTested: string
  snapshotEvidence: string
  manifestIdentity: string
  manifestHash: string
  publishRecord: string
  sourceName: string
  publishedAt: string
  immutableVersionTitle: string
  immutableVersionDescription: string
  candidateContentTitle: string
  candidateContentDescription: string
  overviewDashboard: WorkbenchOverviewDashboardCopy
}

export function getWorkbenchHomeCopy(
  translate: TFunction<"workbenchHome">,
): WorkbenchHomeCopy {
  return {
    workbenches: translate("sidebar.workbenches"),
    workbenchList: translate("sidebar.workbenchList"),
    loadingWorkbenches: translate("sidebar.loading"),
    listErrorTitle: translate("sidebar.errorTitle"),
    listErrorDescription: translate("sidebar.errorDescription"),
    retry: translate("sidebar.retry"),
    emptyTitle: translate("sidebar.emptyTitle"),
    emptyDescription: translate("sidebar.emptyDescription"),
    initialCandidateStatus: translate("sidebar.initialCandidate"),
    noFormalVersion: translate("sidebar.noFormalVersion"),
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
        title: translate("setup.steps.validate.title"),
        description: translate("setup.steps.validate.description"),
      },
      {
        title: translate("setup.steps.publish.title"),
        description: translate("setup.steps.publish.description"),
      },
    ],
    localFirstTitle: translate("localFirst.title"),
    localFirstDescription: translate("localFirst.description"),
    initialCandidate: translate("createDialog.initialCandidate"),
    createDialogTitle: translate("createDialog.title"),
    createDialogDescription: translate("createDialog.description"),
    workbenchName: translate("createDialog.workbenchName"),
    workbenchNamePlaceholder: translate(
      "createDialog.workbenchNamePlaceholder",
    ),
    workbenchNameHelp: translate("createDialog.workbenchNameHelp"),
    skillSource: translate("createDialog.skillSource"),
    sourceScope: translate("createDialog.sourceScope"),
    sourceKinds: {
      single_file: {
        label: translate("createDialog.sources.singleFile.label"),
        description: translate("createDialog.sources.singleFile.description"),
        choose: translate("createDialog.sources.singleFile.choose"),
      },
      folder: {
        label: translate("createDialog.sources.folder.label"),
        description: translate("createDialog.sources.folder.description"),
        choose: translate("createDialog.sources.folder.choose"),
      },
      zip: {
        label: translate("createDialog.sources.zip.label"),
        description: translate("createDialog.sources.zip.description"),
        choose: translate("createDialog.sources.zip.choose"),
      },
    },
    dropHint: translate("createDialog.dropHint"),
    preparingSource: translate("createDialog.preparingSource"),
    preparingSourceDescription: translate(
      "createDialog.preparingSourceDescription",
    ),
    uploadingSource: translate("createDialog.uploadingSource"),
    uploadingSourceDescription: translate(
      "createDialog.uploadingSourceDescription",
    ),
    loadingUploadPolicy: translate("createDialog.loadingUploadPolicy"),
    uploadPolicyUnavailable: translate(
      "createDialog.uploadPolicyUnavailable",
    ),
    importSummary: translate("createDialog.importSummary"),
    readyForValidation: translate("createDialog.readyForValidation"),
    sourceType: translate("createDialog.sourceType"),
    fileCount: translate("createDialog.fileCount"),
    totalSize: translate("createDialog.totalSize"),
    directoryDepth: translate("createDialog.directoryDepth"),
    serverValidationNote: translate("createDialog.serverValidationNote"),
    ignoredFolderFiles: (count) =>
      translate("createDialog.ignoredFolderFiles", { count }),
    cancel: translate("createDialog.cancel"),
    createWorkbenchAndCandidate: translate(
      "createDialog.createWorkbenchAndCandidate",
    ),
    savingCandidate: translate("createDialog.savingCandidate"),
    nameRequired: translate("createDialog.nameRequired"),
    sourceErrors: {
      sourceRequired: translate("createDialog.errors.sourceRequired"),
      folderSelectionRequired: translate(
        "createDialog.errors.folderSelectionRequired",
      ),
      folderPolicyUnavailable: translate(
        "createDialog.errors.folderPolicyUnavailable",
      ),
      folderFilesIgnored: translate(
        "createDialog.errors.folderFilesIgnored",
      ),
      zipRequired: translate("createDialog.errors.zipRequired"),
    },
    createFailed: translate("createDialog.createFailed"),
    fileCountExceeded: translate("createDialog.fileCountExceeded"),
    unknownCreateError: translate("createDialog.unknownCreateError"),
    workspaceCreated: translate("notifications.workspaceCreated"),
    backToHome: translate("overview.backToHome"),
    overviewEyebrow: translate("overview.eyebrow"),
    overviewDescription: translate("overview.description"),
    versionState: translate("overview.versionState"),
    publishedWithoutTests: translate("overview.publishedWithoutTests"),
    candidateWithoutTests: translate("overview.candidateWithoutTests"),
    versionSummary: translate("overview.versionSummary"),
    currentVersion: translate("overview.currentVersion"),
    defaultBaseline: translate("overview.defaultBaseline"),
    v1DefaultBaseline: translate("overview.v1DefaultBaseline"),
    notBaseline: translate("overview.notBaseline"),
    testState: translate("overview.testState"),
    notTested: translate("overview.notTested"),
    snapshotEvidence: translate("overview.snapshotEvidence"),
    manifestIdentity: translate("overview.manifestIdentity"),
    manifestHash: translate("overview.manifestHash"),
    publishRecord: translate("overview.publishRecord"),
    sourceName: translate("overview.sourceName"),
    publishedAt: translate("overview.publishedAt"),
    immutableVersionTitle: translate("overview.immutableVersionTitle"),
    immutableVersionDescription: translate(
      "overview.immutableVersionDescription",
    ),
    candidateContentTitle: translate("overview.candidateContentTitle"),
    candidateContentDescription: translate(
      "overview.candidateContentDescription",
    ),
    overviewDashboard: {
      eyebrow: translate("overview.dashboard.eyebrow"),
      description: translate("overview.dashboard.description"),
      publishedVersion: (name) =>
        translate("overview.dashboard.publishedVersion", { name }),
      noPublishedVersion: translate("overview.dashboard.noPublishedVersion"),
      noPublishedVersionValue: translate(
        "overview.dashboard.noPublishedVersionValue",
      ),
      statusTitle: translate("overview.dashboard.statusTitle"),
      currentPublishedVersion: translate(
        "overview.dashboard.currentPublishedVersion",
      ),
      currentPublishedVersionHint: translate(
        "overview.dashboard.currentPublishedVersionHint",
      ),
      savedVersions: translate("overview.dashboard.savedVersions"),
      savedVersionsHint: translate("overview.dashboard.savedVersionsHint"),
      workingCopy: translate("overview.dashboard.workingCopy"),
      recentUpdated: (date) =>
        translate("overview.dashboard.recentUpdated", { date }),
      createFromPublished: translate(
        "overview.dashboard.createFromPublished",
      ),
      revision: (revision) =>
        translate("overview.dashboard.revision", { revision }),
      noActiveDraft: translate("overview.dashboard.noActiveDraft"),
      continueEditingDraft: translate(
        "overview.dashboard.continueEditingDraft",
      ),
      viewSkillVersions: translate("overview.dashboard.viewSkillVersions"),
      compareVersions: translate("overview.dashboard.compareVersions"),
      evidenceWorkspace: translate("overview.dashboard.evidenceWorkspace"),
      futureIteration: translate("overview.dashboard.futureIteration"),
      cards: {
        testCases: {
          title: translate("overview.dashboard.cards.testCases.title"),
          description: translate(
            "overview.dashboard.cards.testCases.description",
          ),
        },
        datasets: {
          title: translate("overview.dashboard.cards.datasets.title"),
          description: translate(
            "overview.dashboard.cards.datasets.description",
          ),
        },
        testRuns: {
          title: translate("overview.dashboard.cards.testRuns.title"),
          description: translate(
            "overview.dashboard.cards.testRuns.description",
          ),
        },
        comparisonReports: {
          title: translate(
            "overview.dashboard.cards.comparisonReports.title",
          ),
          description: translate(
            "overview.dashboard.cards.comparisonReports.description",
          ),
        },
      },
      versionTagsTitle: translate("overview.dashboard.versionTagsTitle"),
      versionTagsDescription: translate(
        "overview.dashboard.versionTagsDescription",
      ),
    },
  }
}
