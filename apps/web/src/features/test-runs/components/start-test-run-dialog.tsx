import { LockKeyhole, Play, Scale, ShieldCheck } from "lucide-react"
import { useState } from "react"
import type { TFunction } from "i18next"

import type { EvalRevision } from "@/features/evals/model/evals"
import type { SkillDraftSummary } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"

export function StartTestRunDialog({
  open,
  draft,
  revisions,
  selectedRevisionId,
  selectedRevision,
  blocked,
  pending,
  onOpenChange,
  onRevisionChange,
  onStart,
  t,
}: {
  open: boolean
  draft: SkillDraftSummary | null
  revisions: readonly EvalRevision[]
  selectedRevisionId: string
  selectedRevision: EvalRevision | null
  blocked: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onRevisionChange: (revisionId: string) => void
  onStart: () => Promise<unknown>
  t: TFunction<"testRuns">
}) {
  const selectionSignature = `${draft?.id ?? ""}:${draft?.contentRevision ?? ""}:${selectedRevisionId}`
  const [confirmedSelection, setConfirmedSelection] = useState<string | null>(
    null,
  )
  const confirmed = confirmedSelection === selectionSignature

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmedSelection(null)
        onOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent className="max-w-2xl rounded-none border-foreground p-0">
        <DialogHeader className="border-b border-foreground px-6 py-5 pr-14">
          <div className="technical-heading text-[10px] text-signal-dark">
            {t("start.eyebrow")}
          </div>
          <DialogTitle className="text-xl">{t("start.title")}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {t("start.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5">
          <div className="grid gap-1.5 text-xs font-semibold">
            {t("start.skillDraft")}
            <div className="min-h-10 border border-foreground bg-background px-3 py-2.5 font-mono text-[11px]">
              {draft
                ? t("start.draftSelection", {
                    revision: draft.contentRevision,
                    source: draft.sourceName,
                  })
                : t("start.noDraft")}
            </div>
          </div>

          <label className="grid gap-1.5 text-xs font-semibold">
            {t("start.evalRevision")}
            <select
              className="h-10 border border-foreground bg-background px-3 font-mono text-[11px] outline-none focus:border-primary"
              disabled={blocked || pending}
              onChange={(event) => {
                setConfirmedSelection(null)
                onRevisionChange(event.target.value)
              }}
              value={selectedRevisionId}
            >
              <option value="">{t("start.chooseRevision")}</option>
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  EVALS R{revision.sequenceNumber} · {revision.skillName} ·{" "}
                  {t("start.evalCount", { count: revision.evalCount })}
                </option>
              ))}
            </select>
          </label>

          {draft && selectedRevision ? (
            <div className="grid grid-cols-2 gap-px border border-foreground bg-rule">
              <div className="bg-background p-3">
                <span className="font-mono text-[9px] text-muted-foreground uppercase">
                  {t("start.frozenSkill")}
                </span>
                <strong className="mt-1 block text-sm">
                  {t("start.draftRevision", {
                    revision: draft.contentRevision,
                  })}
                </strong>
                <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                  {t("start.freezeOnStart")}
                </span>
              </div>
              <div className="bg-background p-3">
                <span className="font-mono text-[9px] text-muted-foreground uppercase">
                  {t("start.frozenEvals")}
                </span>
                <strong className="mt-1 block text-sm">
                  EVALS R{selectedRevision.sequenceNumber}
                </strong>
                <code className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                  {selectedRevision.manifestHash}
                </code>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border border-technical/45 bg-technical/6 p-4">
            <Scale className="mt-0.5 size-4 text-technical" />
            <div>
              <strong className="text-xs">{t("start.modeTitle")}</strong>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {t("start.modeDescription")}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 border border-rule-soft bg-paper-muted px-4 py-3 text-xs leading-5">
            <input
              checked={confirmed}
              className="mt-1"
              disabled={!draft || !selectedRevision || blocked || pending}
              onChange={(event) =>
                setConfirmedSelection(
                  event.target.checked ? selectionSignature : null,
                )
              }
              type="checkbox"
            />
            <span>
              <strong className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-status-passed" />
                {t("start.confirmTitle")}
              </strong>
              <span className="mt-1 block text-muted-foreground">
                {selectedRevision
                  ? t("start.confirmSelection", {
                      revision: selectedRevision.sequenceNumber,
                      count: selectedRevision.evalCount,
                    })
                  : t("start.confirmPlaceholder")}
              </span>
            </span>
          </label>

          {blocked ? (
            <div className="flex gap-2 border border-status-running/50 px-4 py-3 text-xs text-status-running">
              <LockKeyhole className="size-4 shrink-0" />
              {t("start.activeRunBlocked")}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-foreground bg-paper-muted px-6 py-4">
          <Button
            className="rounded-none"
            disabled={
              blocked ||
              pending ||
              !draft ||
              !selectedRevisionId ||
              !confirmed
            }
            onClick={() => {
              void onStart().catch(() => undefined)
            }}
            type="button"
          >
            <Play data-icon="inline-start" />
            {t("start.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
