import {
  ArrowLeft,
  Baseline,
  CheckCircle2,
  History,
  LoaderCircle,
  LockKeyhole,
  PackageOpen,
  RotateCcw,
} from "lucide-react"

import { VersionFilePreview } from "@/features/version-browser/components/version-file-preview"
import { VersionFileTree } from "@/features/version-browser/components/version-file-tree"
import { VersionMetadataPanel } from "@/features/version-browser/components/version-metadata-panel"
import { useVersionBrowserController } from "@/features/version-browser/hooks/use-version-browser-controller"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

interface VersionBrowserViewProps {
  workspace: SkillWorkspace
  locale: string
  selectedVersionId: string | null
  selectedFilePath: string | null
  onBack: () => void
  onVersionSelect: (versionId: string) => void
  onFileSelect: (relativePath: string) => void
}

export function VersionBrowserView({
  workspace,
  locale,
  selectedVersionId,
  selectedFilePath,
  onBack,
  onVersionSelect,
  onFileSelect,
}: VersionBrowserViewProps) {
  const controller = useVersionBrowserController({
    workspaceId: workspace.id,
    selectedVersionId,
    selectedFilePath,
  })
  const { copy, selectedVersion } = controller

  if (controller.loading) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-10 py-9">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {copy.loading}
        </div>
      </main>
    )
  }

  if (controller.error || !selectedVersion) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-10 py-9">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <PackageOpen
            aria-hidden="true"
            className="mx-auto mb-3 size-8 text-destructive"
          />
          <strong className="block">{copy.loadError}</strong>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {copy.workspaceUnavailable}
          </p>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {copy.retry}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-7 pt-5 pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Button
              className="mb-2 h-auto rounded-none px-0 py-0 text-xs"
              onClick={onBack}
              type="button"
              variant="link"
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {copy.backToHome}
            </Button>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              {selectedVersion.isCurrent ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
              ) : (
                <History aria-hidden="true" className="size-3.5" />
              )}
              {copy.eyebrow} / V{selectedVersion.versionNumber}
            </div>
            <h1 className="truncate text-[clamp(1.75rem,2.4vw,2.5rem)] leading-none font-[780] tracking-[-0.035em]">
              {workspace.name}
            </h1>
          </div>

          <div className="flex shrink-0 items-end gap-3">
            <label className="grid gap-1 font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
              {copy.versionPicker}
              <select
                aria-label={copy.versionPicker}
                className="h-9 min-w-44 border border-foreground bg-paper-raised px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
                onChange={(event) => onVersionSelect(event.target.value)}
                value={selectedVersion.id}
              >
                {controller.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    V{version.versionNumber}
                    {version.isCurrent ? ` · ${copy.currentVersion}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex h-9 items-center gap-2 border border-rule bg-paper-raised px-3 font-mono text-[10px]">
              {selectedVersion.isCurrent ? (
                <>
                  <CheckCircle2 aria-hidden="true" className="size-3.5 text-signal-dark" />
                  {copy.currentVersion}
                </>
              ) : (
                <>
                  <History aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {copy.historicalVersion}
                </>
              )}
            </div>
            {selectedVersion.isDefaultBaseline ? (
              <div className="flex h-9 items-center gap-2 border border-rule bg-paper-raised px-3 font-mono text-[10px]">
                <Baseline aria-hidden="true" className="size-3.5 text-technical" />
                {copy.defaultBaseline}
              </div>
            ) : null}
            <div className="flex h-9 items-center border border-rule bg-paper-muted px-3 font-mono text-[10px] text-muted-foreground">
              {copy.notTested}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 border border-technical/55 bg-technical/5 px-3.5 py-2 text-xs text-technical-foreground">
          <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
          <strong>{copy.immutableTitle}</strong>
          <span className="text-muted-foreground">
            {copy.immutableDescription}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,17rem)_minmax(24rem,1fr)_minmax(14rem,17rem)] overflow-hidden">
        <VersionFileTree
          copy={copy}
          fileCount={controller.files.length}
          onFileSelect={onFileSelect}
          onSearchTermChange={controller.actions.setSearchTerm}
          searchTerm={controller.searchTerm}
          selectedPath={controller.selectedFilePath}
          tree={controller.tree}
        />
        <VersionFilePreview
          copy={copy}
          downloadUrl={controller.downloadUrl}
          file={controller.selectedFile}
          imagePreviewUrl={controller.imagePreviewUrl}
          loading={controller.filesLoading || controller.previewLoading}
          markdownView={controller.markdownView}
          onMarkdownViewChange={controller.actions.setMarkdownView}
          onPathSelect={onFileSelect}
          onRetry={controller.actions.retryPreview}
          previewIssue={controller.previewIssue}
          textPreview={controller.textPreview}
        />
        <VersionMetadataPanel
          copy={copy}
          file={controller.selectedFile}
          locale={locale}
          version={selectedVersion}
        />
      </div>
    </main>
  )
}
