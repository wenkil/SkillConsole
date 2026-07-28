import {
  CheckCircle2,
  FileArchive,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  ScanSearch,
  Upload,
} from "lucide-react"
import type {
  ChangeEvent,
  DragEvent,
  InputHTMLAttributes,
} from "react"
import { useState } from "react"

import type {
  CreateSkillSourceKind,
  CreateWorkbenchDraft,
  CreateWorkbenchErrors,
} from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"
import { buttonVariants } from "@/shared/components/ui/button.variants"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { Input } from "@/shared/components/ui/input"
import { Label } from "@/shared/components/ui/label"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group"
import { cn } from "@/shared/lib/utils"

interface CreateWorkbenchDialogProps {
  open: boolean
  draft: CreateWorkbenchDraft
  errors: CreateWorkbenchErrors
  submitting: boolean
  folderPolicyStatus: "loading" | "ready" | "error"
  copy: WorkbenchHomeCopy
  onOpenChange: (open: boolean) => void
  onNameChange: (name: string) => void
  onSourceKindChange: (kind: CreateSkillSourceKind) => void
  onSourceSelect: (files: readonly File[]) => void | Promise<void>
  onSubmit: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function sourceErrorMessage(
  error: CreateWorkbenchErrors["source"],
  copy: WorkbenchHomeCopy,
): string | null {
  if (!error) return null
  return copy.sourceErrors[error]
}

const sourceIcons = {
  folder: FolderOpen,
  zip: FileArchive,
} satisfies Record<CreateSkillSourceKind, typeof FolderOpen>

function waitForBusyStatePaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0)
      return
    }

    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

export function CreateWorkbenchDialog({
  open,
  draft,
  errors,
  submitting,
  folderPolicyStatus,
  copy,
  onOpenChange,
  onNameChange,
  onSourceKindChange,
  onSourceSelect,
  onSubmit,
}: CreateWorkbenchDialogProps) {
  const [isPreparingSource, setPreparingSource] = useState(false)
  const sourceInputId = `workbench-${draft.sourceKind}-source`
  const SelectedSourceIcon = sourceIcons[draft.sourceKind]
  const sourceError = sourceErrorMessage(errors.source, copy)
  const interactionLocked = submitting || isPreparingSource
  const folderPolicyBlocked =
    draft.sourceKind === "folder" && folderPolicyStatus !== "ready"
  let dropHint = copy.dropHint
  if (folderPolicyBlocked) {
    dropHint =
      folderPolicyStatus === "error"
        ? copy.uploadPolicyUnavailable
        : copy.loadingUploadPolicy
  }

  async function prepareSource(files: readonly File[]) {
    setPreparingSource(true)
    try {
      await waitForBusyStatePaint()
      await onSourceSelect(files)
    } finally {
      setPreparingSource(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void prepareSource(Array.from(event.target.files ?? []))
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    if (folderPolicyBlocked || interactionLocked) return
    void prepareSource(Array.from(event.dataTransfer.files))
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isPreparingSource) return
        onOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent
        aria-busy={interactionLocked}
        className="gap-0 rounded-none border-foreground bg-paper-raised p-0 shadow-[12px_12px_0_rgb(16_24_32/18%)] sm:max-w-3xl"
        showCloseButton={!interactionLocked}
      >
        <DialogHeader className="border-b border-foreground px-6 py-5">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
            <span>01</span>
            <span>/</span>
            <span>{copy.initialCandidate}</span>
          </div>
          <DialogTitle className="flex items-center gap-2.5 font-mono text-base">
            <FolderPlus aria-hidden="true" className="size-5 text-primary" />
            {copy.createDialogTitle}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {copy.createDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-5 overflow-x-hidden overflow-y-auto px-6 py-5">
          <div className="grid gap-2">
            <Label htmlFor="workbench-name">{copy.workbenchName}</Label>
            <Input
              aria-invalid={Boolean(errors.name)}
              className="h-10 rounded-none bg-white/45 shadow-none"
              disabled={interactionLocked}
              id="workbench-name"
              maxLength={120}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={copy.workbenchNamePlaceholder}
              value={draft.name}
            />
            <p className="text-xs text-muted-foreground">
              {copy.workbenchNameHelp}
            </p>
            {errors.name && (
              <p className="text-xs text-destructive">{copy.nameRequired}</p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-end justify-between gap-4">
              <Label>{copy.skillSource}</Label>
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                {copy.sourceScope}
              </span>
            </div>
            <ToggleGroup
              className="grid w-full grid-cols-2 gap-2"
              disabled={interactionLocked}
              onValueChange={(value) => {
                if (value === "folder" || value === "zip") {
                  onSourceKindChange(value)
                }
              }}
              type="single"
              value={draft.sourceKind}
              variant="outline"
            >
              {(["folder", "zip"] as const).map((sourceKind) => {
                const Icon = sourceIcons[sourceKind]
                return (
                  <ToggleGroupItem
                    className="h-auto min-h-24 w-full max-w-full shrink items-start justify-start gap-3 overflow-hidden rounded-none border border-rule px-4 py-3 text-left whitespace-normal data-[state=on]:border-primary data-[state=on]:bg-accent"
                    key={sourceKind}
                    value={sourceKind}
                  >
                    <Icon
                      aria-hidden="true"
                      className="mt-0.5 size-6 shrink-0"
                    />
                    <span className="min-w-0">
                      <strong className="block">
                        {copy.sourceKinds[sourceKind].label}
                      </strong>
                      <span className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground">
                        {copy.sourceKinds[sourceKind].description}
                      </span>
                    </span>
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </div>

          <Input
            accept={
              draft.sourceKind === "zip"
                ? ".zip,application/zip"
                : undefined
            }
            className="sr-only"
            disabled={interactionLocked || folderPolicyBlocked}
            id={sourceInputId}
            key={draft.sourceKind}
            multiple={draft.sourceKind === "folder"}
            onChange={handleFileChange}
            type="file"
            {...(draft.sourceKind === "folder"
              ? ({
                  webkitdirectory: "",
                } as InputHTMLAttributes<HTMLInputElement>)
              : {})}
          />

          <Label
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex h-28 w-full flex-col gap-1.5 rounded-none border-dashed border-rule bg-background text-muted-foreground shadow-none hover:border-primary hover:bg-accent hover:text-signal-dark",
              (interactionLocked || folderPolicyBlocked) &&
                "pointer-events-none opacity-60",
            )}
            aria-busy={isPreparingSource}
            aria-live="polite"
            htmlFor={sourceInputId}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {isPreparingSource || submitting ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-7 animate-spin text-primary"
                />
                <strong className="text-foreground">
                  {isPreparingSource
                    ? copy.preparingSource
                    : copy.uploadingSource}
                </strong>
                <span className="text-xs">
                  {isPreparingSource
                    ? copy.preparingSourceDescription
                    : copy.uploadingSourceDescription}
                </span>
              </>
            ) : (
              <>
                <Upload aria-hidden="true" className="size-7" />
                <strong className="text-foreground">
                  {copy.sourceKinds[draft.sourceKind].choose}
                </strong>
                <span className="text-xs">{dropHint}</span>
              </>
            )}
          </Label>

          {draft.source && !interactionLocked && (
            <section
              aria-label={copy.importSummary}
              className="border border-technical bg-white/35"
            >
              <div className="flex items-center justify-between border-b border-technical/45 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-4 shrink-0 text-technical"
                  />
                  <strong className="truncate font-mono text-xs">
                    {draft.source.name}
                  </strong>
                </div>
                <span className="font-mono text-[10px] font-bold tracking-wider text-technical-foreground uppercase">
                  {copy.readyForValidation}
                </span>
              </div>
              <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] divide-x divide-technical/30">
                <div className="px-4 py-3">
                  <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                    {copy.sourceType}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                    <SelectedSourceIcon
                      aria-hidden="true"
                      className="size-3.5"
                    />
                    {copy.sourceKinds[draft.sourceKind].label}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                    {copy.fileCount}
                  </span>
                  <strong className="mt-1 block font-mono text-xs">
                    {draft.source.fileCount}
                  </strong>
                </div>
                <div className="px-4 py-3">
                  <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                    {copy.totalSize}
                  </span>
                  <strong className="mt-1 block font-mono text-xs">
                    {formatBytes(draft.source.totalBytes)}
                  </strong>
                </div>
                <div className="px-4 py-3">
                  <span className="block font-mono text-[10px] text-muted-foreground uppercase">
                    {copy.directoryDepth}
                  </span>
                  <strong className="mt-1 block font-mono text-xs">
                    {draft.source.maxDepth}
                  </strong>
                </div>
              </div>
              <p className="flex items-center gap-2 border-t border-technical/30 px-4 py-2.5 text-[11px] text-muted-foreground">
                <ScanSearch
                  aria-hidden="true"
                  className="size-3.5 text-technical"
                />
                {copy.serverValidationNote}
              </p>
              {draft.source.ignoredFileCount > 0 && (
                <p className="border-t border-technical/30 px-4 py-2.5 text-[11px] font-semibold text-technical-foreground">
                  {copy.ignoredFolderFiles(
                    draft.source.ignoredFileCount,
                  )}
                </p>
              )}
            </section>
          )}

          {sourceError && !interactionLocked && (
            <p className="text-xs text-destructive">{sourceError}</p>
          )}

          {errors.upload && !interactionLocked && (
            <div className="border-l-4 border-destructive bg-destructive/8 px-4 py-3 text-sm text-destructive">
              <strong className="block">{copy.createFailed}</strong>
              <span className="mt-1 block text-xs">{errors.upload}</span>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-foreground px-5 py-4">
          <DialogClose asChild>
            <Button
              className="rounded-none border-foreground shadow-none"
              disabled={interactionLocked}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            className="min-w-44 rounded-none font-bold shadow-none"
            disabled={interactionLocked}
            onClick={onSubmit}
            type="button"
          >
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <FolderPlus aria-hidden="true" data-icon="inline-start" />
            )}
            {submitting
              ? copy.savingCandidate
              : copy.createWorkbenchAndCandidate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
