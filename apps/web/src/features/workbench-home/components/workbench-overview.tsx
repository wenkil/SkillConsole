import {
  ArrowLeft,
  Baseline,
  Box,
  CalendarClock,
  CheckCircle2,
  FileStack,
  Fingerprint,
  FlaskConicalOff,
  PackageCheck,
} from "lucide-react"

import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"

interface WorkbenchOverviewProps {
  workspace: SkillWorkspace
  copy: WorkbenchHomeCopy
  locale: string
  onBack: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function WorkbenchOverview({
  workspace,
  copy,
  locale,
  onBack,
}: WorkbenchOverviewProps) {
  const version = workspace.currentVersion
  const snapshot = version.snapshot
  const publishedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(version.publishedAt))

  return (
    <main className="min-w-0 px-10 py-9">
      <Button
        className="mb-5 rounded-none px-0"
        onClick={onBack}
        type="button"
        variant="link"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        {copy.backToHome}
      </Button>

      <header className="border-b border-foreground pb-7">
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.08em] text-signal-dark uppercase">
          <PackageCheck aria-hidden="true" className="size-3.5" />
          {copy.overviewEyebrow} / V{version.versionNumber}
        </div>
        <div className="flex items-end justify-between gap-8">
          <div>
            <h1 className="text-[clamp(2.15rem,3vw,3.15rem)] leading-none font-[780] tracking-[-0.04em]">
              {workspace.name}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {copy.overviewDescription}
            </p>
          </div>
          <div className="shrink-0 border border-technical bg-white/35 px-4 py-3 text-right">
            <span className="block font-mono text-[10px] tracking-wider text-technical-foreground uppercase">
              {copy.versionState}
            </span>
            <strong className="mt-1 flex items-center gap-1.5 text-sm text-technical-foreground">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {copy.publishedWithoutTests}
            </strong>
          </div>
        </div>
      </header>

      <section
        aria-label={copy.versionSummary}
        className="mt-7 grid grid-cols-4 border border-foreground bg-paper-raised"
      >
        <article className="border-r border-rule px-5 py-5">
          <Box aria-hidden="true" className="size-6 text-primary" />
          <span className="mt-4 block font-mono text-[10px] text-muted-foreground uppercase">
            {copy.currentVersion}
          </span>
          <strong className="mt-1 block text-xl">
            V{version.versionNumber}
          </strong>
        </article>
        <article className="border-r border-rule px-5 py-5">
          <Baseline aria-hidden="true" className="size-6 text-technical" />
          <span className="mt-4 block font-mono text-[10px] text-muted-foreground uppercase">
            {copy.defaultBaseline}
          </span>
          <strong className="mt-1 block text-sm">
            {version.isDefaultBaseline
              ? copy.v1DefaultBaseline
              : copy.notBaseline}
          </strong>
        </article>
        <article className="border-r border-rule px-5 py-5">
          <FileStack aria-hidden="true" className="size-6 text-technical" />
          <span className="mt-4 block font-mono text-[10px] text-muted-foreground uppercase">
            {copy.sourceType}
          </span>
          <strong className="mt-1 block truncate text-sm">
            {copy.sourceKinds[version.sourceType].label}
          </strong>
        </article>
        <article className="px-5 py-5">
          <FlaskConicalOff
            aria-hidden="true"
            className="size-6 text-muted-foreground"
          />
          <span className="mt-4 block font-mono text-[10px] text-muted-foreground uppercase">
            {copy.testState}
          </span>
          <strong className="mt-1 block text-sm">{copy.notTested}</strong>
        </article>
      </section>

      <section className="mt-7">
        <h2 className="flex items-center gap-2.5 border-b border-rule pb-3 font-mono text-base tracking-[0.015em]">
          <span className="font-extrabold text-primary">01</span>
          <span>/</span>
          <span>{copy.snapshotEvidence}</span>
        </h2>

        <div className="mt-4 grid grid-cols-[1.1fr_1fr] gap-4">
          <article className="technical-panel p-5">
            <div className="flex items-center gap-2">
              <Fingerprint
                aria-hidden="true"
                className="size-5 text-technical"
              />
              <h3 className="technical-heading text-[12px]">
                {copy.manifestIdentity}
              </h3>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
              <div>
                <dt className="font-mono text-[10px] text-muted-foreground uppercase">
                  {copy.fileCount}
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  {snapshot.fileCount}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] text-muted-foreground uppercase">
                  {copy.totalSize}
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  {formatBytes(snapshot.totalBytes)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="font-mono text-[10px] text-muted-foreground uppercase">
                  {copy.manifestHash}
                </dt>
                <dd
                  className="mt-1 truncate font-mono text-xs"
                  title={snapshot.manifestHash}
                >
                  sha256:{snapshot.manifestHash}
                </dd>
              </div>
            </dl>
          </article>

          <article className="technical-panel p-5">
            <div className="flex items-center gap-2">
              <CalendarClock
                aria-hidden="true"
                className="size-5 text-technical"
              />
              <h3 className="technical-heading text-[12px]">
                {copy.publishRecord}
              </h3>
            </div>
            <dl className="mt-5 grid gap-4">
              <div>
                <dt className="font-mono text-[10px] text-muted-foreground uppercase">
                  {copy.sourceName}
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold">
                  {version.sourceName}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] text-muted-foreground uppercase">
                  {copy.publishedAt}
                </dt>
                <dd className="mt-1 text-sm font-semibold">{publishedAt}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div className="mt-4 border border-rule bg-paper-muted px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          <strong className="mr-2 text-foreground">
            {copy.immutableVersionTitle}
          </strong>
          {copy.immutableVersionDescription}
        </div>
      </section>
    </main>
  )
}
