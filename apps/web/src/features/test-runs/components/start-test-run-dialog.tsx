import {
  GitCompare,
  LockKeyhole,
  Play,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { useState } from "react"
import type { TFunction } from "i18next"

import type { EvalRevision } from "@/features/evals/model/evals"
import type { TestRunMode } from "@/features/test-runs/model/test-run"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
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
import { cn } from "@/shared/lib/utils"

function versionLabel(version: SkillVersionBrowser): string {
  return `R${version.sequenceNumber} · ${version.name}`
}

export function StartTestRunDialog({
  open,
  draft,
  revisions,
  versions,
  versionsLoading,
  versionsError,
  mode,
  baselineVersionId,
  baselineVersion,
  candidateVersionId,
  candidateVersion,
  selectedRevisionId,
  selectedRevision,
  blocked,
  pending,
  onOpenChange,
  onModeChange,
  onBaselineVersionChange,
  onCandidateVersionChange,
  onRevisionChange,
  onStart,
  t,
}: {
  open: boolean
  draft: SkillDraftSummary | null
  revisions: readonly EvalRevision[]
  versions: readonly SkillVersionBrowser[]
  versionsLoading: boolean
  versionsError: boolean
  mode: TestRunMode
  baselineVersionId: string
  baselineVersion: SkillVersionBrowser | null
  candidateVersionId: string
  candidateVersion: SkillVersionBrowser | null
  selectedRevisionId: string
  selectedRevision: EvalRevision | null
  blocked: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onModeChange: (mode: TestRunMode) => void
  onBaselineVersionChange: (versionId: string) => void
  onCandidateVersionChange: (versionId: string) => void
  onRevisionChange: (revisionId: string) => void
  onStart: () => Promise<unknown>
  t: TFunction<"testRuns">
}) {
  const comparisonAvailable =
    !versionsLoading && !versionsError && versions.length >= 2
  const validSelection =
    Boolean(selectedRevision) &&
    (mode === "target_vs_no_skill"
      ? Boolean(draft)
      : Boolean(
          baselineVersion &&
            candidateVersion &&
            baselineVersion.id !== candidateVersion.id,
        ))
  const selectionSignature = [
    mode,
    selectedRevisionId,
    mode === "target_vs_no_skill"
      ? `${draft?.id ?? ""}:${draft?.contentRevision ?? ""}`
      : `${baselineVersionId}:${candidateVersionId}`,
  ].join(":")
  const [confirmedSelection, setConfirmedSelection] = useState<string | null>(
    null,
  )
  const confirmed = confirmedSelection === selectionSignature
  const executionCaseCount = (selectedRevision?.evalCount ?? 0) * 2

  const resetConfirmation = () => setConfirmedSelection(null)

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetConfirmation()
        onOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto rounded-none border-foreground p-0">
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
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-semibold">
              {t("start.testMode")}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={cn(
                  "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 border p-4",
                  mode === "target_vs_no_skill"
                    ? "border-primary bg-primary/5"
                    : "border-rule hover:border-foreground",
                )}
              >
                <input
                  checked={mode === "target_vs_no_skill"}
                  className="mt-1"
                  disabled={blocked || pending}
                  name="test-run-mode"
                  onChange={() => {
                    resetConfirmation()
                    onModeChange("target_vs_no_skill")
                  }}
                  type="radio"
                  value="target_vs_no_skill"
                />
                <span>
                  <strong className="flex items-center gap-2 text-xs">
                    <Sparkles className="size-3.5 text-primary" />
                    {t("start.skillEffectMode")}
                  </strong>
                  <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                    {t("start.skillEffectModeDescription")}
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)] gap-3 border p-4",
                  comparisonAvailable && "cursor-pointer",
                  mode === "version_vs_version"
                    ? "border-primary bg-primary/5"
                    : "border-rule",
                  !comparisonAvailable && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  checked={mode === "version_vs_version"}
                  className="mt-1"
                  disabled={!comparisonAvailable || blocked || pending}
                  name="test-run-mode"
                  onChange={() => {
                    resetConfirmation()
                    onModeChange("version_vs_version")
                  }}
                  type="radio"
                  value="version_vs_version"
                />
                <span>
                  <strong className="flex items-center gap-2 text-xs">
                    <GitCompare className="size-3.5 text-technical" />
                    {t("start.versionComparisonMode")}
                  </strong>
                  <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                    {comparisonAvailable
                      ? t("start.versionComparisonModeDescription")
                      : versionsError
                        ? t("start.versionLoadError")
                        : versionsLoading
                          ? t("start.versionLoading")
                          : t("start.notEnoughVersions")}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {mode === "target_vs_no_skill" ? (
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
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-xs font-semibold">
                {t("start.baselineVersion")}
                <select
                  className="h-10 border border-foreground bg-background px-3 font-mono text-[11px] outline-none focus:border-primary"
                  disabled={!comparisonAvailable || blocked || pending}
                  onChange={(event) => {
                    resetConfirmation()
                    onBaselineVersionChange(event.target.value)
                  }}
                  value={baselineVersionId}
                >
                  <option value="">{t("start.chooseBaselineVersion")}</option>
                  {versions.map((version) => (
                    <option
                      disabled={version.id === candidateVersionId}
                      key={version.id}
                      value={version.id}
                    >
                      {versionLabel(version)}
                      {version.isComparisonBaseline
                        ? ` · ${t("start.recommendedBaseline")}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                {t("start.candidateVersion")}
                <select
                  className="h-10 border border-foreground bg-background px-3 font-mono text-[11px] outline-none focus:border-primary"
                  disabled={!comparisonAvailable || blocked || pending}
                  onChange={(event) => {
                    resetConfirmation()
                    onCandidateVersionChange(event.target.value)
                  }}
                  value={candidateVersionId}
                >
                  <option value="">{t("start.chooseCandidateVersion")}</option>
                  {versions.map((version) => (
                    <option
                      disabled={version.id === baselineVersionId}
                      key={version.id}
                      value={version.id}
                    >
                      {versionLabel(version)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="grid gap-1.5 text-xs font-semibold">
            {t("start.evalRevision")}
            <select
              className="h-10 border border-foreground bg-background px-3 font-mono text-[11px] outline-none focus:border-primary"
              disabled={blocked || pending}
              onChange={(event) => {
                resetConfirmation()
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

          {validSelection && selectedRevision ? (
            <div className="grid grid-cols-3 gap-px border border-foreground bg-rule">
              <div className="bg-background p-3">
                <span className="font-mono text-[9px] text-muted-foreground uppercase">
                  {t("start.baselineSubject")}
                </span>
                <strong className="mt-1 block text-sm">
                  {mode === "target_vs_no_skill"
                    ? t("start.noSkillBaseline")
                    : baselineVersion
                      ? versionLabel(baselineVersion)
                      : "—"}
                </strong>
              </div>
              <div className="bg-background p-3">
                <span className="font-mono text-[9px] text-muted-foreground uppercase">
                  {t("start.targetSubject")}
                </span>
                <strong className="mt-1 block text-sm">
                  {mode === "target_vs_no_skill"
                    ? t("start.draftRevision", {
                        revision: draft?.contentRevision,
                      })
                    : candidateVersion
                      ? versionLabel(candidateVersion)
                      : "—"}
                </strong>
                {mode === "target_vs_no_skill" ? (
                  <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                    {t("start.freezeOnStart")}
                  </span>
                ) : null}
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
              <strong className="text-xs">
                {t(
                  mode === "target_vs_no_skill"
                    ? "start.skillEffectSummary"
                    : "start.versionComparisonSummary",
                )}
              </strong>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {t(
                  mode === "target_vs_no_skill"
                    ? "start.skillEffectSummaryDescription"
                    : "start.versionComparisonSummaryDescription",
                )}
              </p>
              {selectedRevision ? (
                <>
                  <div className="mt-3 border border-rule bg-rule font-mono text-[9px]">
                    <span className="bg-background p-2">
                      {t("start.executionCount", {
                        count: executionCaseCount,
                      })}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <label className="flex items-start gap-3 border border-rule-soft bg-paper-muted px-4 py-3 text-xs leading-5">
            <input
              checked={confirmed}
              className="mt-1"
              disabled={!validSelection || blocked || pending}
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
                {selectedRevision && validSelection
                  ? t(
                      mode === "target_vs_no_skill"
                        ? "start.confirmSkillEffect"
                        : "start.confirmVersionComparison",
                      {
                        revision: selectedRevision.sequenceNumber,
                        count: selectedRevision.evalCount,
                        baseline: baselineVersion
                          ? versionLabel(baselineVersion)
                          : "",
                        candidate: candidateVersion
                          ? versionLabel(candidateVersion)
                          : "",
                      },
                    )
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
              !validSelection ||
              !selectedRevisionId ||
              !confirmed
            }
            onClick={() => {
              void onStart().catch(() => undefined)
            }}
            type="button"
          >
            <Play data-icon="inline-start" />
            {t(
              mode === "target_vs_no_skill"
                ? "start.actionSkillEffect"
                : "start.actionVersionComparison",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
