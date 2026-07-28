import { LoaderCircle, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { SnapshotFile } from "@/features/version-browser/model/version-browser"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"

interface DraftFileDeleteButtonProps {
  file: SnapshotFile
  pending: boolean
  onDeleteFile: () => Promise<void>
}

export function DraftFileDeleteButton({
  file,
  pending,
  onDeleteFile,
}: DraftFileDeleteButtonProps) {
  const { t } = useTranslation("versionBrowser")
  const [open, setOpen] = useState(false)

  function closeDialog() {
    if (!pending) setOpen(false)
  }

  return (
    <>
      <Button
        className="h-8 rounded-none text-destructive hover:text-destructive"
        disabled={pending}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        {t("draft.deleteFile")}
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeDialog()
        }}
        open={open}
      >
        <DialogContent
          className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-lg"
          showCloseButton={!pending}
        >
          <DialogHeader className="border-b border-foreground px-5 py-4">
            <DialogTitle className="font-mono text-base">
              {t("fileActions.deleteTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {t("fileActions.deleteDescription", {
                path: file.relativePath,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-5">
            <div className="border border-destructive/50 bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-destructive">
              {t("fileActions.deleteWarning")}
            </div>
          </div>

          <DialogFooter className="border-t border-foreground px-5 py-4">
            <Button
              className="rounded-none"
              disabled={pending}
              onClick={closeDialog}
              type="button"
              variant="outline"
            >
              {t("draft.cancel")}
            </Button>
            <Button
              className="rounded-none"
              disabled={pending}
              onClick={() => {
                void onDeleteFile()
                  .then(closeDialog)
                  .catch(() => undefined)
              }}
              type="button"
              variant="destructive"
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <Trash2 aria-hidden="true" data-icon="inline-start" />
              )}
              {t("draft.deleteFile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
