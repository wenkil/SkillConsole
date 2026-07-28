import { EllipsisVertical, LoaderCircle, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { DropdownMenu } from "radix-ui"

import type {
  DraftDiff,
  SkillDraftBrowser,
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

interface DraftLifecycleMenuProps {
  draft: SkillDraftBrowser
  diff: DraftDiff | null
  pending: boolean
  onAbandon: () => Promise<void>
}

export function DraftLifecycleMenu({
  draft,
  diff,
  pending,
  onAbandon,
}: DraftLifecycleMenuProps) {
  const { t } = useTranslation("versionBrowser")
  const [confirming, setConfirming] = useState(false)
  const changedCount = diff
    ? diff.summary.added + diff.summary.modified + diff.summary.deleted
    : 0

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={t("lifecycle.more")}
            className="size-9 rounded-none p-0"
            disabled={pending}
            size="icon"
            type="button"
            variant="outline"
          >
            <EllipsisVertical aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-52 border border-foreground bg-paper-raised p-1 shadow-[6px_6px_0_var(--rule-soft)]"
            sideOffset={5}
          >
            <DropdownMenu.Label className="px-3 py-2 font-mono text-[9px] text-muted-foreground uppercase">
              {t("lifecycle.draftActions")}
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="h-px bg-rule-soft" />
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-destructive outline-none data-[highlighted]:bg-destructive/8"
              onSelect={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t("draft.abandon")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(false)
        }}
        open={confirming}
      >
        <DialogContent
          className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-lg"
          showCloseButton={!pending}
        >
          <DialogHeader className="border-b border-foreground px-5 py-4">
            <DialogTitle className="font-mono text-base">
              {t("lifecycle.abandonTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {t("lifecycle.abandonDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 px-5 py-5">
            <div className="border border-rule bg-paper-muted px-3 py-3">
              <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                {t("metadata.contentRevision")}
              </span>
              <strong className="mt-1.5 block text-sm">
                R{draft.contentRevision}
              </strong>
            </div>
            <div className="border border-rule bg-paper-muted px-3 py-3">
              <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                {t("lifecycle.changedFiles")}
              </span>
              <strong className="mt-1.5 block text-sm">{changedCount}</strong>
            </div>
            <p className="col-span-2 border border-destructive/50 bg-destructive/5 px-4 py-3 text-xs leading-relaxed text-destructive">
              {t("draft.confirmAbandon")}
            </p>
          </div>
          <DialogFooter className="border-t border-foreground px-5 py-4">
            <Button
              className="rounded-none"
              disabled={pending}
              onClick={() => setConfirming(false)}
              type="button"
              variant="outline"
            >
              {t("draft.cancel")}
            </Button>
            <Button
              className="rounded-none"
              disabled={pending}
              onClick={() => {
                void onAbandon()
                  .then(() => setConfirming(false))
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
              {t("draft.abandon")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
