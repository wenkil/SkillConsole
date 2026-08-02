import type { TFunction } from "i18next"

export interface VersionBrowserCopy {
  backToHome: string
  eyebrow: string
  versionPrefix: string
  formalVersion: string
  versionPicker: string
  draftTarget: (revision: number) => string
  versionTarget: (name: string, isOnline: boolean) => string
  compareVersions: string
  currentOnlineBadge: string
  currentVersion: string
  historicalVersion: string
  initialCandidate: string
  candidateState: string
  defaultBaseline: string
  notTested: string
  immutableTitle: string
  immutableDescription: string
  candidateTitle: string
  candidateDescription: string
  candidateFilesSummary: (count: number) => string
  frozenVersionTitle: string
  versionFilesSummary: (count: number, labels: string) => string
  noLabels: string
  files: string
  searchFiles: string
  noSearchResults: string
  fileTreeHelp: string
  preview: string
  source: string
  rendered: string
  loading: string
  loadError: string
  retry: string
  noFileSelected: string
  unavailableTitle: string
  unavailableDescription: string
  missingFileTitle: string
  corruptedFileTitle: string
  snapshotUnavailableTitle: string
  invalidUtf8Title: string
  binaryFileTitle: string
  imageUnavailableTitle: string
  download: string
  newVersionDraft: string
  saveAsVersion: string
  versionInfo: string
  candidateInfo: string
  snapshotInfo: string
  versionNumber: string
  sourceType: string
  sourceName: string
  publishedAt: string
  updatedAt: string
  contentRevision: string
  createdAt: string
  snapshotState: string
  fileCount: string
  totalSize: string
  manifestHash: string
  fileInfo: string
  path: string
  mediaType: string
  byteSize: string
  sha256: string
  contentKind: string
  text: string
  binary: string
  ready: string
  corrupted: string
  staging: string
  workspaceUnavailable: string
  rawHtmlDisabled: string
  sourceTypes: {
    single_file: string
    folder: string
    zip: string
  }
}

export function getVersionBrowserCopy(
  translate: TFunction<"versionBrowser">,
): VersionBrowserCopy {
  return {
    backToHome: translate("actions.backToHome"),
    eyebrow: translate("header.eyebrow"),
    versionPrefix: translate("header.versionPrefix"),
    formalVersion: translate("header.formalVersion"),
    versionPicker: translate("header.versionPicker"),
    draftTarget: (revision) =>
      translate("header.draftTarget", { revision }),
    versionTarget: (name, isOnline) =>
      translate("header.versionTarget", {
        name,
        suffix: isOnline ? translate("header.currentOnlineSuffix") : "",
      }),
    compareVersions: translate("header.compareVersions"),
    currentOnlineBadge: translate("header.currentOnlineBadge"),
    currentVersion: translate("header.currentVersion"),
    historicalVersion: translate("header.historicalVersion"),
    initialCandidate: translate("header.initialCandidate"),
    candidateState: translate("header.candidateState"),
    defaultBaseline: translate("header.defaultBaseline"),
    notTested: translate("header.notTested"),
    immutableTitle: translate("immutable.title"),
    immutableDescription: translate("immutable.description"),
    candidateTitle: translate("candidate.title"),
    candidateDescription: translate("candidate.description"),
    candidateFilesSummary: (count) =>
      translate("candidate.filesSummary", { count }),
    frozenVersionTitle: translate("immutable.frozenVersionTitle"),
    versionFilesSummary: (count, labels) =>
      translate("immutable.filesSummary", { count, labels }),
    noLabels: translate("immutable.noLabels"),
    files: translate("tree.files"),
    searchFiles: translate("tree.search"),
    noSearchResults: translate("tree.noResults"),
    fileTreeHelp: translate("tree.keyboardHelp"),
    preview: translate("preview.title"),
    source: translate("preview.source"),
    rendered: translate("preview.rendered"),
    loading: translate("states.loading"),
    loadError: translate("states.loadError"),
    retry: translate("states.retry"),
    noFileSelected: translate("states.noFileSelected"),
    unavailableTitle: translate("states.unavailableTitle"),
    unavailableDescription: translate("states.unavailableDescription"),
    missingFileTitle: translate("states.missingFileTitle"),
    corruptedFileTitle: translate("states.corruptedFileTitle"),
    snapshotUnavailableTitle: translate("states.snapshotUnavailableTitle"),
    invalidUtf8Title: translate("states.invalidUtf8Title"),
    binaryFileTitle: translate("states.binaryFileTitle"),
    imageUnavailableTitle: translate("states.imageUnavailableTitle"),
    download: translate("actions.download"),
    newVersionDraft: translate("draft.newVersion"),
    saveAsVersion: translate("draft.saveAsVersion"),
    versionInfo: translate("metadata.version"),
    candidateInfo: translate("metadata.candidate"),
    snapshotInfo: translate("metadata.snapshot"),
    versionNumber: translate("metadata.versionNumber"),
    sourceType: translate("metadata.sourceType"),
    sourceName: translate("metadata.sourceName"),
    publishedAt: translate("metadata.publishedAt"),
    updatedAt: translate("metadata.updatedAt"),
    contentRevision: translate("metadata.contentRevision"),
    createdAt: translate("metadata.createdAt"),
    snapshotState: translate("metadata.snapshotState"),
    fileCount: translate("metadata.fileCount"),
    totalSize: translate("metadata.totalSize"),
    manifestHash: translate("metadata.manifestHash"),
    fileInfo: translate("metadata.file"),
    path: translate("metadata.path"),
    mediaType: translate("metadata.mediaType"),
    byteSize: translate("metadata.byteSize"),
    sha256: translate("metadata.sha256"),
    contentKind: translate("metadata.contentKind"),
    text: translate("metadata.text"),
    binary: translate("metadata.binary"),
    ready: translate("metadata.ready"),
    corrupted: translate("metadata.corrupted"),
    staging: translate("metadata.staging"),
    workspaceUnavailable: translate("states.workspaceUnavailable"),
    rawHtmlDisabled: translate("preview.rawHtmlDisabled"),
    sourceTypes: {
      single_file: translate("sourceTypes.singleFile"),
      folder: translate("sourceTypes.folder"),
      zip: translate("sourceTypes.zip"),
    },
  }
}
