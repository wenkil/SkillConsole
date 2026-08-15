import {
  ChevronDown,
  FilePlus2,
  FolderPlus,
  LoaderCircle,
  Upload,
} from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DropdownMenu } from "radix-ui"

import {
  formatBytes,
  type DraftFolderMergePreview,
  type SkillDraftBrowser,
} from "@/features/version-browser/model/version-browser"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { Input } from "@/shared/components/ui/input"

interface DraftUploadMenuProps {
  draft: SkillDraftBrowser
  folderPreview: DraftFolderMergePreview | null
  pending: boolean
  onUploadFile: (file: File, relativePath: string) => Promise<void>
  onPreviewFolder: (
    files: readonly File[],
    ignoreRules: readonly string[],
  ) => Promise<void>
  onCommitFolder: () => Promise<void>
  onClearFolderPreview: () => void
}

function PreviewMetric({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="border border-rule-soft bg-paper-muted px-2 py-2">
      <strong className="block font-mono text-sm">{value}</strong>
      <span className="ui-label">
        {label}
      </span>
    </div>
  )
}

export function DraftUploadMenu({
  draft,
  folderPreview,
  pending,
  onUploadFile,
  onPreviewFolder,
  onCommitFolder,
  onClearFolderPreview,
}: DraftUploadMenuProps) {
  const { t } = useTranslation("versionBrowser")
  const singleInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<"single" | "folder" | null>(null)
  const [singleFile, setSingleFile] = useState<File | null>(null)
  const [singlePath, setSinglePath] = useState("")
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [ignoreRules, setIgnoreRules] = useState(draft.ignoreRules.join("\n"))

  function resetDialog() {
    setMode(null)
    setSingleFile(null)
    setSinglePath("")
    setFolderFiles([])
    onClearFolderPreview()
    if (singleInputRef.current) singleInputRef.current.value = ""
    if (folderInputRef.current) folderInputRef.current.value = ""
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={t("upload.menuLabel")}
            className="h-8 rounded-none px-2.5"
            disabled={pending}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload aria-hidden="true" data-icon="inline-start" />
            {t("upload.menuLabel")}
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-64 border border-border-strong bg-paper-raised p-1 shadow-[6px_6px_0_var(--rule-soft)]"
            sideOffset={5}
          >
            <DropdownMenu.Item
              className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-xs outline-none data-[highlighted]:bg-accent"
              onSelect={() => {
                window.setTimeout(() => singleInputRef.current?.click(), 0)
              }}
            >
              <FilePlus2
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>
                <strong className="block">{t("upload.singleTitle")}</strong>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {t("upload.singleDescription")}
                </span>
              </span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-rule-soft" />
            <DropdownMenu.Item
              className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-xs outline-none data-[highlighted]:bg-accent"
              onSelect={() => {
                window.setTimeout(() => folderInputRef.current?.click(), 0)
              }}
            >
              <FolderPlus
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-technical"
              />
              <span>
                <strong className="block">{t("upload.folderTitle")}</strong>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {t("upload.folderDescription")}
                </span>
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <input
        hidden
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null
          if (!selected) return
          setSingleFile(selected)
          setSinglePath(selected.name)
          setMode("single")
        }}
        ref={singleInputRef}
        type="file"
      />
      <input
        {...({
          webkitdirectory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        hidden
        multiple
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? [])
          if (selected.length === 0) return
          setFolderFiles(selected)
          setMode("folder")
        }}
        ref={folderInputRef}
        type="file"
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open && !pending) resetDialog()
        }}
        open={mode !== null}
      >
        <DialogContent
          className="max-h-[88vh] gap-0 overflow-hidden rounded-none border-border-strong bg-paper-raised p-0 sm:max-w-2xl"
          showCloseButton={!pending}
        >
          <DialogHeader className="border-b border-border-strong px-5 py-4">
            <DialogTitle className="font-mono text-base">
              {mode === "single"
                ? t("upload.singleDialogTitle")
                : t("upload.folderDialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6">
              {mode === "single"
                ? t("upload.singleDialogDescription")
                : t("upload.folderDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          {mode === "single" ? (
            <div className="grid gap-4 overflow-y-auto px-5 py-5">
              <div className="border border-rule bg-paper-muted px-3 py-3">
                <span className="ui-label block">
                  {t("upload.selectedFile")}
                </span>
                <strong className="mt-1.5 block truncate font-mono text-xs">
                  {singleFile?.name}
                </strong>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold">
                {t("draft.uploadPath")}
                <Input
                  className="h-10 rounded-none font-mono text-sm"
                  disabled={pending}
                  onChange={(event) => setSinglePath(event.target.value)}
                  placeholder={t("draft.uploadPathPlaceholder")}
                  value={singlePath}
                />
              </label>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("upload.replaceWarning")}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 overflow-y-auto px-5 py-5">
              <div className="border border-technical/50 bg-technical/5 px-3 py-3">
                <span className="ui-label block">
                  {t("upload.selectedFolder")}
                </span>
                <strong className="mt-1.5 block text-xs">
                  {t("draft.selectedFolderFiles", {
                    count: folderFiles.length,
                  })}
                </strong>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold">
                {t("draft.customIgnore")}
                <textarea
                  className="min-h-24 resize-y border border-border-default bg-background p-2.5 font-mono text-sm leading-6 outline-none focus:border-focus-ring"
                  disabled={pending}
                  onChange={(event) => setIgnoreRules(event.target.value)}
                  value={ignoreRules}
                />
              </label>
              {!folderPreview ? (
                <div className="border border-dashed border-border-default px-4 py-4 text-sm leading-6 text-muted-foreground">
                  {t("upload.previewRequired")}
                </div>
              ) : (
                <div className="grid gap-3 border border-technical/50 bg-technical/5 p-3">
                    <strong className="ui-label">
                    {t("draft.replacementConfirmation", {
                      count: folderPreview.summary.totalFiles,
                      size: formatBytes(folderPreview.summary.totalBytes),
                    })}
                  </strong>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    <PreviewMetric
                      label="Added"
                      value={folderPreview.summary.added}
                    />
                    <PreviewMetric
                      label="Modified"
                      value={folderPreview.summary.modified}
                    />
                    <PreviewMetric
                      label="Unchanged"
                      value={folderPreview.summary.unchanged}
                    />
                    <PreviewMetric
                      label="Ignored"
                      value={folderPreview.summary.ignored}
                    />
                    <PreviewMetric
                      label="Conflict"
                      value={folderPreview.summary.conflicts}
                    />
                    <PreviewMetric
                      label="Binary"
                      value={folderPreview.summary.unpreviewable}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="border-t border-border-strong px-5 py-4">
            <Button
              className="rounded-none"
              disabled={pending}
              onClick={resetDialog}
              type="button"
              variant="outline"
            >
              {t("draft.cancel")}
            </Button>
            {mode === "single" ? (
              <Button
                className="rounded-none"
                disabled={!singleFile || !singlePath.trim() || pending}
                onClick={() => {
                  if (!singleFile) return
                  void onUploadFile(singleFile, singlePath.trim())
                    .then(resetDialog)
                    .catch(() => undefined)
                }}
                type="button"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Upload aria-hidden="true" data-icon="inline-start" />
                )}
                {pending
                  ? t("draft.updating")
                  : t("draft.uploadToDraft")}
              </Button>
            ) : !folderPreview ? (
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
                type="button"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : null}
                {t("draft.previewReplacement")}
              </Button>
            ) : (
              <Button
                className="rounded-none"
                disabled={
                  !folderPreview.committable ||
                  pending
                }
                onClick={() => {
                  void onCommitFolder()
                    .then(resetDialog)
                    .catch(() => undefined)
                }}
                type="button"
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : null}
                {t("draft.confirmReplacement")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
