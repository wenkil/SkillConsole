import {
  CheckCircle2,
  FileArchive,
  FolderOpen,
  FolderPlus,
  Upload,
} from "lucide-react"
import type {
  ChangeEvent,
  DragEvent,
  InputHTMLAttributes,
} from "react"

import type {
  CreateWorkbenchDraft,
  CreateWorkbenchErrors,
  SkillSourceKind,
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
  copy: WorkbenchHomeCopy
  onOpenChange: (open: boolean) => void
  onNameChange: (name: string) => void
  onSourceKindChange: (kind: SkillSourceKind) => void
  onSourceSelect: (sourceName: string) => void
  onSubmit: () => void
}

function getSourceName(
  sourceKind: SkillSourceKind,
  files: FileList | null,
): string | null {
  const firstFile = files?.item(0)
  if (!firstFile) return null

  if (sourceKind === "folder") {
    return firstFile.webkitRelativePath.split("/")[0] || firstFile.name
  }

  return firstFile.name
}

export function CreateWorkbenchDialog({
  open,
  draft,
  errors,
  copy,
  onOpenChange,
  onNameChange,
  onSourceKindChange,
  onSourceSelect,
  onSubmit,
}: CreateWorkbenchDialogProps) {
  const sourceInputId =
    draft.sourceKind === "folder"
      ? "workbench-folder-source"
      : "workbench-zip-source"

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const sourceName = getSourceName(draft.sourceKind, event.target.files)
    if (sourceName) onSourceSelect(sourceName)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    const sourceName = getSourceName(
      draft.sourceKind,
      event.dataTransfer.files,
    )
    if (sourceName) onSourceSelect(sourceName)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 shadow-[12px_12px_0_rgb(16_24_32/18%)] sm:max-w-2xl">
        <DialogHeader className="border-b border-foreground px-5 py-5">
          <DialogTitle className="flex items-center gap-2.5 font-mono text-base">
            <FolderPlus aria-hidden="true" className="size-5 text-primary" />
            {copy.createDialogTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {copy.workbenchNameHelp}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5">
          <div className="grid gap-2">
            <Label htmlFor="workbench-name">{copy.workbenchName}</Label>
            <Input
              aria-invalid={Boolean(errors.name)}
              className="h-10 rounded-none bg-white/45 shadow-none"
              id="workbench-name"
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
            <Label>{copy.skillSource}</Label>
            <ToggleGroup
              className="grid w-full grid-cols-2 gap-2"
              onValueChange={(value) => {
                if (value === "folder" || value === "zip") {
                  onSourceKindChange(value)
                }
              }}
              type="single"
              value={draft.sourceKind}
              variant="outline"
            >
              <ToggleGroupItem
                className="h-auto min-h-24 items-start justify-start gap-3 rounded-none border border-rule px-4 py-3 text-left data-[state=on]:border-primary data-[state=on]:bg-accent"
                value="folder"
              >
                <FolderOpen
                  aria-hidden="true"
                  className="mt-0.5 size-6 shrink-0"
                />
                <span>
                  <strong className="block">{copy.folder}</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {copy.folderDescription}
                  </span>
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                className="h-auto min-h-24 items-start justify-start gap-3 rounded-none border border-rule px-4 py-3 text-left data-[state=on]:border-primary data-[state=on]:bg-accent"
                value="zip"
              >
                <FileArchive
                  aria-hidden="true"
                  className="mt-0.5 size-6 shrink-0"
                />
                <span>
                  <strong className="block">{copy.zip}</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {copy.zipDescription}
                  </span>
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Input
            accept={draft.sourceKind === "zip" ? ".zip,application/zip" : undefined}
            className="sr-only"
            id={sourceInputId}
            key={draft.sourceKind}
            multiple={draft.sourceKind === "folder"}
            onChange={handleFileChange}
            type="file"
            {...(draft.sourceKind === "folder"
              ? ({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)
              : {})}
          />

          <Label
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex h-28 w-full flex-col gap-1.5 rounded-none border-dashed border-rule bg-background text-muted-foreground shadow-none hover:border-primary hover:bg-accent hover:text-signal-dark",
            )}
            htmlFor={sourceInputId}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload aria-hidden="true" className="size-7" />
            <strong className="text-foreground">
              {draft.sourceKind === "folder"
                ? copy.chooseFolder
                : copy.chooseZip}
            </strong>
            <span className="text-xs">{copy.dropHint}</span>
          </Label>

          {draft.sourceName && (
            <div className="flex items-center gap-2 border border-technical bg-white/35 px-3 py-2.5 font-mono text-xs text-technical-foreground">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {copy.selectedSource}: {draft.sourceName}
            </div>
          )}

          {errors.source && (
            <p className="text-xs text-destructive">{copy.sourceRequired}</p>
          )}
        </div>

        <DialogFooter className="border-t border-foreground px-5 py-4">
          <DialogClose asChild>
            <Button
              className="rounded-none border-foreground shadow-none"
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            className="rounded-none font-bold shadow-none"
            onClick={onSubmit}
            type="button"
          >
            <FolderPlus aria-hidden="true" data-icon="inline-start" />
            {copy.createProject}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
