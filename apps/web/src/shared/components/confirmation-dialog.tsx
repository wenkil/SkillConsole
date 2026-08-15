import { useState, type ComponentProps } from "react"

import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"

export function ConfirmationDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  confirmVariant = "default",
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  confirmVariant?: ComponentProps<typeof Button>["variant"]
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<unknown>
}) {
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // The caller owns error presentation and may keep the dialog open to retry.
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent
        className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-rule-soft px-5 py-4 pr-12">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-5">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-rule-soft bg-paper-muted px-5 py-3 sm:justify-end">
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              void handleConfirm()
            }}
            type="button"
            variant={confirmVariant}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
