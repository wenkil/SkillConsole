import {
  Baseline,
  CalendarClock,
  CircleDashed,
  Files,
  Fingerprint,
  GitCompareArrows,
  Info,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  formatBytes,
  type DraftDiff,
  type SkillBrowserTarget,
} from "@/features/version-browser/model/version-browser"
import type { VersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog"

interface VersionContextBarProps {
  target: SkillBrowserTarget
  diff: DraftDiff | null
  baseVersionNumber: number | null
  locale: string
  copy: VersionBrowserCopy
  onSelectPath: (relativePath: string) => void
}

function ContextMetric({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 border-r border-rule-soft px-4 py-3 last:border-r-0">
      <span className="block font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <strong className="mt-1.5 flex min-w-0 items-center gap-2 truncate text-xs">
        {children}
      </strong>
    </div>
  )
}

function MetadataItem({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "mt-1.5 break-all font-mono text-[11px] leading-relaxed"
            : "mt-1.5 text-sm font-semibold"
        }
      >
        {value}
      </dd>
    </div>
  )
}

export function VersionContextBar({
  target,
  diff,
  baseVersionNumber,
  locale,
  copy,
  onSelectPath,
}: VersionContextBarProps) {
  const { t } = useTranslation("versionBrowser")
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const changedEntries =
    diff?.entries.filter((entry) => entry.status !== "UNCHANGED") ?? []
  const changedCount = diff
    ? diff.summary.added + diff.summary.modified + diff.summary.deleted
    : 0
  const targetLabel =
    target.kind === "draft"
      ? t("context.activeDraft")
      : `V${target.versionNumber}`
  const basisLabel =
    target.kind === "draft"
      ? baseVersionNumber
        ? `V${baseVersionNumber}`
        : t("draft.initialBasis")
      : target.isDefaultBaseline
        ? copy.defaultBaseline
        : t("context.notBaseline")
  const recordedAt =
    target.kind === "draft" ? target.updatedAt : target.publishedAt

  return (
    <section className="shrink-0 border-b border-foreground bg-paper-raised">
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <ContextMetric label={t("context.target")}>
          {targetLabel}
        </ContextMetric>
        <ContextMetric label={t("context.basis")}>
          <Baseline aria-hidden="true" className="size-3.5 text-technical" />
          {basisLabel}
        </ContextMetric>
        <ContextMetric
          label={
            target.kind === "draft"
              ? copy.contentRevision
              : copy.snapshotState
          }
        >
          {target.kind === "draft"
            ? `R${target.contentRevision}`
            : copy.ready}
        </ContextMetric>
        <ContextMetric label={t("context.changesAndFiles")}>
          <Files aria-hidden="true" className="size-3.5 text-technical" />
          {target.kind === "draft"
            ? t("context.changeCount", {
              changed: changedCount,
              files: target.snapshot.fileCount,
            })
            : t("context.fileCount", {
              files: target.snapshot.fileCount,
            })}
        </ContextMetric>

        <div className="flex items-center gap-2 px-3">
          {target.kind === "draft" ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  className="h-8 rounded-none px-3"
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <GitCompareArrows
                    aria-hidden="true"
                    data-icon="inline-start"
                  />
                  {t("context.viewChanges", { count: changedCount })}
                </Button>
              </DialogTrigger>
              <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-2xl">
                <DialogHeader className="border-b border-foreground px-5 py-4">
                  <DialogTitle className="font-mono text-base">
                    {t("context.changedFilesTitle")}
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {t("context.changedFilesDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[55vh] overflow-y-auto p-4">
                  {changedEntries.length > 0 ? (
                    <div className="border border-rule">
                      {changedEntries.map((entry) => (
                        <button
                          className="flex w-full items-center gap-3 border-b border-rule-soft px-3 py-2.5 text-left last:border-b-0 enabled:hover:bg-paper-muted disabled:cursor-default"
                          disabled={!entry.current}
                          key={`${entry.status}:${entry.relativePath}`}
                          onClick={() => onSelectPath(entry.relativePath)}
                          type="button"
                        >
                          <span className="w-17 shrink-0 font-mono text-[9px] font-bold text-technical-foreground">
                            {entry.status}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                            {entry.relativePath}
                          </span>
                          {!entry.current ? (
                            <span className="font-mono text-[9px] text-muted-foreground uppercase">
                              {t("context.deleted")}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-32 items-center justify-center border border-dashed border-rule px-6 text-center text-xs text-muted-foreground">
                      {t("draft.noChanges")}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          ) : null}

          <Dialog>
            <DialogTrigger asChild>
              <Button
                aria-label={t("context.versionInfo")}
                className="size-8 rounded-none p-0"
                size="icon"
                type="button"
                variant="outline"
              >
                <Info aria-hidden="true" className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-xl">
              <DialogHeader className="border-b border-foreground px-5 py-4">
                <DialogTitle className="font-mono text-base">
                  {target.kind === "draft"
                    ? copy.candidateInfo
                    : copy.versionInfo}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {t("context.versionInfoDescription")}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5">
                <MetadataItem
                  label={copy.sourceType}
                  value={copy.sourceTypes[target.sourceType]}
                />
                <MetadataItem label={copy.sourceName} value={target.sourceName} />
                <MetadataItem
                  label={copy.fileCount}
                  value={target.snapshot.fileCount}
                />
                <MetadataItem
                  label={copy.totalSize}
                  value={formatBytes(target.snapshot.totalBytes)}
                />
                <MetadataItem
                  label={
                    target.kind === "draft" ? copy.updatedAt : copy.publishedAt
                  }
                  value={
                    <span className="inline-flex items-center gap-2">
                      <CalendarClock
                        aria-hidden="true"
                        className="size-3.5 text-technical"
                      />
                      {dateFormatter.format(new Date(recordedAt))}
                    </span>
                  }
                />
                <MetadataItem
                  label={copy.snapshotState}
                  value={
                    <span className="inline-flex items-center gap-2">
                      <CircleDashed
                        aria-hidden="true"
                        className="size-3.5 text-technical"
                      />
                      {target.snapshot.state}
                    </span>
                  }
                />
                <div className="col-span-2 border-t border-rule-soft pt-4">
                  <MetadataItem
                    label={copy.manifestHash}
                    mono
                    value={
                      <span className="inline-flex items-start gap-2">
                        <Fingerprint
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-technical"
                        />
                        {target.snapshot.manifestHash}
                      </span>
                    }
                  />
                </div>
              </dl>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </section>
  )
}
