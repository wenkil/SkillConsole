import {
  Binary,
  CalendarClock,
  FileKey2,
  Fingerprint,
  PackageCheck,
} from "lucide-react"

import {
  formatBytes,
  type SkillVersionBrowser,
  type SnapshotFile,
} from "@/features/version-browser/model/version-browser"
import type { VersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { cn } from "@/shared/lib/utils"

interface VersionMetadataPanelProps {
  version: SkillVersionBrowser
  file: SnapshotFile | null
  locale: string
  copy: VersionBrowserCopy
}

function MetadataSection({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 border-b border-rule">
      <h2 className="flex items-center gap-2 border-b border-rule-soft px-4 py-3 font-mono text-[11px] font-bold tracking-[0.04em] uppercase">
        <span className="text-primary">{number}</span>
        <span>/</span>
        {title}
      </h2>
      <div className="min-w-0 px-4 py-4">{children}</div>
    </section>
  )
}

function MetadataRow({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 break-words text-xs leading-relaxed font-semibold",
          mono && "font-mono font-medium [overflow-wrap:anywhere]",
        )}
      >
        {children}
      </dd>
    </div>
  )
}

export function VersionMetadataPanel({
  version,
  file,
  locale,
  copy,
}: VersionMetadataPanelProps) {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const snapshotStateCopy = {
    READY: copy.ready,
    CORRUPTED: copy.corrupted,
    STAGING: copy.staging,
  } as const

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-foreground bg-paper-raised">
      <MetadataSection number="01" title={copy.versionInfo}>
        <div className="mb-4 flex items-center gap-2 text-technical-foreground">
          <PackageCheck aria-hidden="true" className="size-4" />
          <strong className="text-sm">V{version.versionNumber}</strong>
        </div>
        <dl className="grid min-w-0 gap-4">
          <MetadataRow label={copy.sourceType}>
            {copy.sourceTypes[version.sourceType]}
          </MetadataRow>
          <MetadataRow label={copy.sourceName}>
            {version.sourceName}
          </MetadataRow>
          <MetadataRow label={copy.publishedAt}>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              {dateFormatter.format(new Date(version.publishedAt))}
            </span>
          </MetadataRow>
        </dl>
      </MetadataSection>

      <MetadataSection number="02" title={copy.snapshotInfo}>
        <div className="mb-4 flex items-center gap-2 text-technical-foreground">
          <Fingerprint aria-hidden="true" className="size-4" />
          <strong className="text-xs">
            {snapshotStateCopy[version.snapshot.state]}
          </strong>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
          <MetadataRow label={copy.fileCount}>
            {version.snapshot.fileCount}
          </MetadataRow>
          <MetadataRow label={copy.totalSize}>
            {formatBytes(version.snapshot.totalBytes)}
          </MetadataRow>
          <div className="col-span-2">
            <MetadataRow label={copy.createdAt}>
              {dateFormatter.format(new Date(version.snapshot.createdAt))}
            </MetadataRow>
          </div>
          <div className="col-span-2">
            <MetadataRow label={copy.manifestHash} mono>
              <span title={version.snapshot.manifestHash}>
                {version.snapshot.manifestHash}
              </span>
            </MetadataRow>
          </div>
        </dl>
      </MetadataSection>

      {file ? (
        <MetadataSection number="03" title={copy.fileInfo}>
          <div className="mb-4 flex items-center gap-2 text-technical-foreground">
            {file.contentKind === "binary" ? (
              <Binary aria-hidden="true" className="size-4" />
            ) : (
              <FileKey2 aria-hidden="true" className="size-4" />
            )}
            <strong className="truncate text-xs">
              {file.relativePath.split("/").at(-1)}
            </strong>
          </div>
          <dl className="grid min-w-0 gap-4">
            <MetadataRow label={copy.path} mono>
              {file.relativePath}
            </MetadataRow>
            <div className="grid grid-cols-2 gap-3">
              <MetadataRow label={copy.byteSize}>
                {formatBytes(file.byteSize)}
              </MetadataRow>
              <MetadataRow label={copy.contentKind}>
                {file.contentKind === "text" ? copy.text : copy.binary}
              </MetadataRow>
            </div>
            <MetadataRow label={copy.mediaType} mono>
              {file.mediaTypeHint}
            </MetadataRow>
            <MetadataRow label={copy.sha256} mono>
              <span title={file.sha256}>{file.sha256}</span>
            </MetadataRow>
          </dl>
        </MetadataSection>
      ) : null}
    </aside>
  )
}
