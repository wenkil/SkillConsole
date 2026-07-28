import {
  FileInput,
  FolderSync,
  GitCompareArrows,
  LoaderCircle,
  MoveRight,
  Trash2,
  Upload,
} from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  formatBytes,
  type DraftDiff,
  type DraftFolderReplacementPreview,
  type SkillDraftBrowser,
  type SnapshotFile,
} from "@/features/version-browser/model/version-browser"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"

interface DraftChangePanelProps {
  draft: SkillDraftBrowser
  file: SnapshotFile | null
  diff: DraftDiff | null
  folderPreview: DraftFolderReplacementPreview | null
  pending: boolean
  errorMessage: string | null
  onUploadFile: (file: File, relativePath: string) => Promise<void>
  onDeleteFile: (relativePath: string) => Promise<void>
  onMoveFile: (fromPath: string, toPath: string) => Promise<void>
  onPreviewFolder: (
    files: readonly File[],
    ignoreRules: readonly string[],
  ) => Promise<void>
  onCommitFolder: (confirmDeletions: boolean) => Promise<void>
  onClearFolderPreview: () => void
  onAbandon: () => Promise<void>
  onSelectPath: (relativePath: string) => void
}

function PanelSection({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-rule">
      <h2 className="flex items-center gap-2 border-b border-rule-soft px-4 py-3 font-mono text-[11px] font-bold tracking-[0.04em] uppercase">
        <span className="text-primary">{number}</span>
        <span>/</span>
        {title}
      </h2>
      <div className="grid gap-3 px-4 py-4">{children}</div>
    </section>
  )
}

function SummaryMetric({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="border border-rule-soft bg-paper-muted px-2 py-2">
      <strong className="block font-mono text-sm">{value}</strong>
      <span className="font-mono text-[8px] tracking-[0.03em] text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  )
}

export function DraftChangePanel({
  draft,
  file,
  diff,
  folderPreview,
  pending,
  errorMessage,
  onUploadFile,
  onDeleteFile,
  onMoveFile,
  onPreviewFolder,
  onCommitFolder,
  onClearFolderPreview,
  onAbandon,
  onSelectPath,
}: DraftChangePanelProps) {
  const { t } = useTranslation("versionBrowser")
  const singleFileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [singleFile, setSingleFile] = useState<File | null>(null)
  const [singlePath, setSinglePath] = useState("")
  const [movePathState, setMovePathState] = useState({
    filePath: file?.relativePath ?? "",
    value: file?.relativePath ?? "",
  })
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [ignoreRules, setIgnoreRules] = useState(
    draft.ignoreRules.join("\n"),
  )
  const [deleteConfirmation, setDeleteConfirmation] = useState({
    filePath: file?.relativePath ?? "",
    confirmed: false,
  })
  const [confirmFolderDeletions, setConfirmFolderDeletions] =
    useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)

  const movePath =
    movePathState.filePath === (file?.relativePath ?? "")
      ? movePathState.value
      : (file?.relativePath ?? "")
  const confirmDelete =
    deleteConfirmation.filePath === (file?.relativePath ?? "") &&
    deleteConfirmation.confirmed

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-foreground bg-paper-raised">
      <PanelSection number="01" title={t("draft.changeSummary")}>
        <div className="flex items-center gap-2 text-technical-foreground">
          <GitCompareArrows aria-hidden="true" className="size-4" />
          <strong className="text-xs">
            {t("draft.revisionState", { revision: draft.contentRevision })}
          </strong>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("draft.basisNotice", {
            basis:
              diff?.basis.kind === "FORMAL_VERSION"
                ? t("draft.versionBasis")
                : t("draft.initialBasis"),
          })}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <SummaryMetric label="Added" value={diff?.summary.added ?? 0} />
          <SummaryMetric
            label="Modified"
            value={diff?.summary.modified ?? 0}
          />
          <SummaryMetric
            label="Deleted"
            value={diff?.summary.deleted ?? 0}
          />
          <SummaryMetric
            label="Ignored"
            value={diff?.summary.ignored ?? 0}
          />
          <SummaryMetric
            label="Binary"
            value={diff?.summary.unpreviewable ?? 0}
          />
          <SummaryMetric
            label="Unchanged"
            value={diff?.summary.unchanged ?? 0}
          />
        </div>
        <div className="grid gap-1">
          <strong className="font-mono text-[9px] tracking-[0.04em] uppercase">
            {t("draft.changedFiles")}
          </strong>
          {diff?.entries.some((entry) => entry.status !== "UNCHANGED") ? (
            <div className="max-h-48 overflow-y-auto border border-rule-soft">
              {diff.entries
                .filter((entry) => entry.status !== "UNCHANGED")
                .map((entry) => (
                  <button
                    className="flex w-full items-center gap-2 border-b border-rule-soft px-2 py-2 text-left last:border-b-0 enabled:hover:bg-paper-muted disabled:cursor-default"
                    disabled={!entry.current}
                    key={`${entry.status}:${entry.relativePath}`}
                    onClick={() => onSelectPath(entry.relativePath)}
                    type="button"
                  >
                    <span className="w-15 shrink-0 font-mono text-[8px] font-bold text-technical-foreground">
                      {entry.status}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[9px]"
                      title={entry.relativePath}
                    >
                      {entry.relativePath}
                    </span>
                    {!entry.previewable && entry.status !== "IGNORED" ? (
                      <span className="shrink-0 font-mono text-[7px] text-muted-foreground uppercase">
                        {t("draft.unpreviewable")}
                      </span>
                    ) : null}
                  </button>
                ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {t("draft.noChanges")}
            </p>
          )}
        </div>
      </PanelSection>

      <PanelSection number="02" title={t("draft.singleFileActions")}>
        <label className="grid gap-1 font-mono text-[9px] uppercase">
          {t("draft.uploadPath")}
          <Input
            className="h-8 rounded-none font-mono text-xs"
            onChange={(event) => setSinglePath(event.target.value)}
            placeholder={t("draft.uploadPathPlaceholder")}
            value={singlePath}
          />
        </label>
        <button
          className="flex items-center justify-center gap-2 border border-rule px-3 py-2 font-mono text-[10px] hover:border-primary"
          onClick={() => singleFileInputRef.current?.click()}
          type="button"
        >
          <FileInput aria-hidden="true" className="size-3.5" />
          {singleFile
            ? t("draft.selectedFile", { name: singleFile.name })
            : t("draft.chooseFile")}
        </button>
        <input
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            setSingleFile(selected)
            if (selected && !singlePath) setSinglePath(selected.name)
          }}
          ref={singleFileInputRef}
          type="file"
        />
        <Button
          className="rounded-none"
          disabled={!singleFile || !singlePath.trim() || pending}
          onClick={() => {
            if (singleFile) {
              void onUploadFile(singleFile, singlePath.trim())
                .then(() => {
                  setSingleFile(null)
                  setSinglePath("")
                  if (singleFileInputRef.current) {
                    singleFileInputRef.current.value = ""
                  }
                })
                .catch(() => undefined)
            }
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Upload aria-hidden="true" data-icon="inline-start" />
          {t("draft.uploadToDraft")}
        </Button>

        {file ? (
          <>
            <div className="mt-2 border-t border-rule-soft pt-3">
              <label className="grid gap-1 font-mono text-[9px] uppercase">
                {t("draft.moveTo")}
                <Input
                  className="h-8 rounded-none font-mono text-xs"
                  onChange={(event) =>
                    setMovePathState({
                      filePath: file.relativePath,
                      value: event.target.value,
                    })
                  }
                  value={movePath}
                />
              </label>
              <Button
                className="mt-2 w-full rounded-none"
                disabled={
                  pending ||
                  !movePath.trim() ||
                  movePath.trim() === file.relativePath
                }
                onClick={() => {
                  void onMoveFile(file.relativePath, movePath.trim()).catch(
                    () => undefined,
                  )
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <MoveRight aria-hidden="true" data-icon="inline-start" />
                {t("draft.move")}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
              <input
                checked={confirmDelete}
                className="mt-0.5"
                onChange={(event) =>
                  setDeleteConfirmation({
                    filePath: file.relativePath,
                    confirmed: event.target.checked,
                  })
                }
                type="checkbox"
              />
              {t("draft.confirmDelete", { path: file.relativePath })}
            </label>
            <Button
              className="rounded-none"
              disabled={!confirmDelete || pending}
              onClick={() => {
                void onDeleteFile(file.relativePath).catch(() => undefined)
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {t("draft.deleteFile")}
            </Button>
          </>
        ) : null}
      </PanelSection>

      <PanelSection number="03" title={t("draft.folderReplacement")}>
        <button
          className="flex items-center justify-center gap-2 border border-rule px-3 py-2 font-mono text-[10px] hover:border-primary"
          onClick={() => folderInputRef.current?.click()}
          type="button"
        >
          <FolderSync aria-hidden="true" className="size-3.5" />
          {folderFiles.length > 0
            ? t("draft.selectedFolderFiles", { count: folderFiles.length })
            : t("draft.chooseFolder")}
        </button>
        <input
          {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          hidden
          multiple
          onChange={(event) =>
            setFolderFiles(Array.from(event.target.files ?? []))
          }
          ref={folderInputRef}
          type="file"
        />
        <label className="grid gap-1 font-mono text-[9px] uppercase">
          {t("draft.customIgnore")}
          <textarea
            className="min-h-20 resize-y border border-rule bg-background p-2 font-mono text-[10px] outline-none focus:border-primary"
            onChange={(event) => setIgnoreRules(event.target.value)}
            value={ignoreRules}
          />
        </label>
        <Button
          className="rounded-none"
          disabled={folderFiles.length === 0 || pending}
          onClick={() => {
            void onPreviewFolder(
              folderFiles,
              ignoreRules
                .split(/\r?\n/)
                .map((rule) => rule.trim())
                .filter(Boolean),
            ).catch(() => undefined)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("draft.previewReplacement")}
        </Button>

        {folderPreview ? (
          <div className="grid gap-2 border border-technical/50 bg-technical/5 p-3">
            <strong className="font-mono text-[10px] uppercase">
              {t("draft.replacementConfirmation", {
                count: folderPreview.summary.totalFiles,
                size: formatBytes(folderPreview.summary.totalBytes),
              })}
            </strong>
            <div className="grid grid-cols-3 gap-1">
              <SummaryMetric
                label="Added"
                value={folderPreview.summary.added}
              />
              <SummaryMetric
                label="Modified"
                value={folderPreview.summary.modified}
              />
              <SummaryMetric
                label="Deleted"
                value={folderPreview.summary.deleted}
              />
              <SummaryMetric
                label="Ignored"
                value={folderPreview.summary.ignored}
              />
              <SummaryMetric
                label="Conflict"
                value={folderPreview.summary.conflicts}
              />
              <SummaryMetric
                label="Binary"
                value={folderPreview.summary.unpreviewable}
              />
            </div>
            {folderPreview.requiresDeletionConfirmation ? (
              <label className="flex items-start gap-2 text-[10px] leading-relaxed">
                <input
                  checked={confirmFolderDeletions}
                  className="mt-0.5"
                  onChange={(event) =>
                    setConfirmFolderDeletions(event.target.checked)
                  }
                  type="checkbox"
                />
                {t("draft.confirmFolderDeletions", {
                  count: folderPreview.summary.deleted,
                })}
              </label>
            ) : null}
            <div className="flex gap-2">
              <Button
                className="flex-1 rounded-none"
                onClick={onClearFolderPreview}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("draft.cancel")}
              </Button>
              <Button
                className="flex-1 rounded-none"
                disabled={
                  !folderPreview.committable ||
                  pending ||
                  (folderPreview.requiresDeletionConfirmation &&
                    !confirmFolderDeletions)
                }
                onClick={() => {
                  void onCommitFolder(confirmFolderDeletions)
                    .then(() => {
                      setFolderFiles([])
                      setConfirmFolderDeletions(false)
                      if (folderInputRef.current) {
                        folderInputRef.current.value = ""
                      }
                    })
                    .catch(() => undefined)
                }}
                size="sm"
                type="button"
              >
                {t("draft.confirmReplacement")}
              </Button>
            </div>
          </div>
        ) : null}
      </PanelSection>

      <PanelSection number="04" title={t("draft.lifecycle")}>
        <label className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
          <input
            checked={confirmAbandon}
            className="mt-0.5"
            onChange={(event) => setConfirmAbandon(event.target.checked)}
            type="checkbox"
          />
          {t("draft.confirmAbandon")}
        </label>
        <Button
          className="rounded-none"
          disabled={!confirmAbandon || pending}
          onClick={() => {
            void onAbandon().catch(() => undefined)
          }}
          size="sm"
          type="button"
          variant="destructive"
        >
          {t("draft.abandon")}
        </Button>
        {pending ? (
          <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            {t("draft.updating")}
          </span>
        ) : null}
        {errorMessage ? (
          <p className="border border-destructive/50 bg-destructive/5 p-2 text-[10px] leading-relaxed text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </PanelSection>
    </aside>
  )
}
