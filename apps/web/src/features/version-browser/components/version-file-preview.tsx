import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { EditorView } from "@codemirror/view"
import CodeMirror from "@uiw/react-codemirror"
import {
  AlertTriangle,
  Download,
  FileQuestion,
  ImageOff,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkFrontmatter from "remark-frontmatter"
import remarkGfm from "remark-gfm"

import {
  getPathSegments,
  type SnapshotFile,
  type TextFilePreview,
  type VersionPreviewIssue,
} from "@/features/version-browser/model/version-browser"
import type { VersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/shared/lib/utils"

interface VersionFilePreviewProps {
  file: SnapshotFile | null
  textPreview: TextFilePreview | null
  imagePreviewUrl: string | null
  downloadUrl: string | null
  loading: boolean
  previewIssue: VersionPreviewIssue | null
  markdownView: "rendered" | "source"
  copy: VersionBrowserCopy
  onMarkdownViewChange: (value: "rendered" | "source") => void
  onRetry: () => void
  onPathSelect: (relativePath: string) => void
}

const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--paper-raised)",
    color: "var(--foreground)",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
  },
  ".cm-gutters": {
    backgroundColor: "var(--paper-muted)",
    borderRight: "1px solid var(--rule-soft)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
})

function getLanguageExtension(kind: TextFilePreview["kind"]) {
  switch (kind) {
    case "markdown":
      return markdown()
    case "json":
      return json()
    case "yaml":
      return yaml()
    default:
      return []
  }
}

function PreviewMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-[28rem] items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center border border-rule bg-paper-muted text-muted-foreground">
          {icon}
        </div>
        <strong className="block text-sm">{title}</strong>
        {description ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  )
}

function ControlledImagePreview({
  imagePreviewUrl,
  relativePath,
  copy,
}: {
  imagePreviewUrl: string
  relativePath: string
  copy: VersionBrowserCopy
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <PreviewMessage
        description={copy.unavailableDescription}
        icon={<ImageOff aria-hidden="true" className="size-5" />}
        title={copy.imageUnavailableTitle}
      />
    )
  }

  return (
    <div className="flex min-h-full items-center justify-center p-8 [background-image:linear-gradient(45deg,var(--paper-muted)_25%,transparent_25%),linear-gradient(-45deg,var(--paper-muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--paper-muted)_75%),linear-gradient(-45deg,transparent_75%,var(--paper-muted)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px]">
      <img
        alt={relativePath}
        className="max-h-[65vh] max-w-full border border-foreground bg-white object-contain shadow-[6px_6px_0_var(--rule-soft)]"
        onError={() => setFailed(true)}
        src={imagePreviewUrl}
      />
    </div>
  )
}

function getPreviewIssueTitle(
  copy: VersionBrowserCopy,
  issue: VersionPreviewIssue,
): string {
  const titles: Record<VersionPreviewIssue, string> = {
    missing: copy.missingFileTitle,
    corrupted: copy.corruptedFileTitle,
    snapshot_unavailable: copy.snapshotUnavailableTitle,
    invalid_utf8: copy.invalidUtf8Title,
    too_large: copy.largeFileTitle,
    binary: copy.binaryFileTitle,
    unavailable: copy.unavailableTitle,
  }
  return titles[issue]
}

function isRetryablePreviewIssue(issue: VersionPreviewIssue): boolean {
  return (
    issue === "missing" ||
    issue === "corrupted" ||
    issue === "snapshot_unavailable" ||
    issue === "unavailable"
  )
}

export function VersionFilePreview({
  file,
  textPreview,
  imagePreviewUrl,
  downloadUrl,
  loading,
  previewIssue,
  markdownView,
  copy,
  onMarkdownViewChange,
  onRetry,
  onPathSelect,
}: VersionFilePreviewProps) {
  const pathSegments = file ? getPathSegments(file.relativePath) : []

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <header className="border-b border-foreground bg-paper-raised">
        <div className="flex min-h-11 items-center justify-between gap-4 px-4">
          <nav
            aria-label={copy.path}
            className="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[10px]"
          >
            <span className="shrink-0 text-primary">/</span>
            {pathSegments.map((segment, index) => (
              <span
                className="flex min-w-0 items-center gap-1"
                key={segment.path}
              >
                {index > 0 ? (
                  <span className="text-muted-foreground">/</span>
                ) : null}
                <button
                  className={cn(
                    "truncate hover:text-primary",
                    index === pathSegments.length - 1 && "font-bold",
                  )}
                  onClick={() => {
                    if (index === pathSegments.length - 1) {
                      onPathSelect(segment.path)
                    }
                  }}
                  title={segment.path}
                  type="button"
                >
                  {segment.label}
                </button>
              </span>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {textPreview?.kind === "markdown" ? (
              <div
                aria-label={copy.preview}
                className="flex border border-rule"
                role="group"
              >
                <button
                  aria-pressed={markdownView === "rendered"}
                  className={cn(
                    "h-7 px-2.5 font-mono text-[10px] uppercase",
                    markdownView === "rendered" &&
                      "bg-foreground text-background",
                  )}
                  onClick={() => onMarkdownViewChange("rendered")}
                  type="button"
                >
                  {copy.rendered}
                </button>
                <button
                  aria-pressed={markdownView === "source"}
                  className={cn(
                    "h-7 border-l border-rule px-2.5 font-mono text-[10px] uppercase",
                    markdownView === "source" &&
                      "bg-foreground text-background",
                  )}
                  onClick={() => onMarkdownViewChange("source")}
                  type="button"
                >
                  {copy.source}
                </button>
              </div>
            ) : null}
            {downloadUrl ? (
              <Button
                asChild
                className="h-8 rounded-none px-3 text-xs shadow-none"
                size="sm"
                variant="outline"
              >
                <a href={downloadUrl}>
                  <Download aria-hidden="true" data-icon="inline-start" />
                  {copy.download}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <PreviewMessage
            icon={
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin"
              />
            }
            title={copy.loading}
          />
        ) : previewIssue ? (
          <PreviewMessage
            action={
              isRetryablePreviewIssue(previewIssue) ? (
                <Button
                  className="rounded-none"
                  onClick={onRetry}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  {copy.retry}
                </Button>
              ) : null
            }
            description={copy.unavailableDescription}
            icon={<AlertTriangle aria-hidden="true" className="size-5" />}
            title={getPreviewIssueTitle(copy, previewIssue)}
          />
        ) : !file ? (
          <PreviewMessage
            icon={<FileQuestion aria-hidden="true" className="size-5" />}
            title={copy.noFileSelected}
          />
        ) : imagePreviewUrl ? (
          <ControlledImagePreview
            copy={copy}
            imagePreviewUrl={imagePreviewUrl}
            key={imagePreviewUrl}
            relativePath={file.relativePath}
          />
        ) : textPreview ? (
          textPreview.kind === "markdown" &&
          markdownView === "rendered" ? (
            <article className="mx-auto max-w-4xl px-10 py-9">
              <div className="mb-6 flex items-center gap-2 border-b border-rule pb-3 font-mono text-[10px] text-technical-foreground uppercase">
                <ShieldCheck aria-hidden="true" className="size-4" />
                {copy.rawHtmlDisabled}
              </div>
              <div className="skill-markdown">
                <ReactMarkdown
                  components={{
                    a: ({ children, ...props }) => (
                      <a
                        {...props}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        {children}
                      </a>
                    ),
                    img: ({ alt }) => (
                      <span className="inline-flex border border-rule-soft bg-paper-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                        {alt || "image"}
                      </span>
                    ),
                  }}
                  remarkPlugins={[remarkFrontmatter, remarkGfm]}
                  skipHtml
                >
                  {textPreview.content}
                </ReactMarkdown>
              </div>
            </article>
          ) : (
            <CodeMirror
              basicSetup={{
                autocompletion: false,
                bracketMatching: true,
                closeBrackets: false,
                foldGutter: true,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                lineNumbers: true,
              }}
              editable={false}
              extensions={[
                getLanguageExtension(textPreview.kind),
                EditorView.lineWrapping,
                codeMirrorTheme,
              ]}
              height="100%"
              readOnly
              value={textPreview.content}
            />
          )
        ) : (
          <PreviewMessage
            description={copy.unavailableDescription}
            icon={<FileQuestion aria-hidden="true" className="size-5" />}
            title={copy.unavailableTitle}
          />
        )}
      </div>
    </section>
  )
}
