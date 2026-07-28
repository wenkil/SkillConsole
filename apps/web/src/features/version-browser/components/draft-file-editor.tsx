import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { MergeView } from "@codemirror/merge"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import CodeMirror from "@uiw/react-codemirror"
import {
  AlertTriangle,
  Columns2,
  LoaderCircle,
  Save,
  Undo2,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type {
  DraftDiffEntry,
  SnapshotFile,
  TextFilePreview,
} from "@/features/version-browser/model/version-browser"
import { Button } from "@/shared/components/ui/button"

interface DraftFileEditorProps {
  file: SnapshotFile
  preview: TextFilePreview
  basePreview: TextFilePreview | null
  conflictServerPreview: TextFilePreview | null
  diffEntry: DraftDiffEntry | null
  saving: boolean
  conflict: boolean
  errorMessage: string | null
  onSave: (content: string) => Promise<void>
  onClearError: () => void
}

const editorTheme = EditorView.theme({
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
})

function languageExtension(kind: TextFilePreview["kind"]) {
  if (kind === "markdown") return markdown()
  if (kind === "json") return json()
  if (kind === "yaml") return yaml()
  return []
}

function MergeComparison({
  comparisonLabel,
  comparisonValue,
  currentLabel,
  currentValue,
  kind,
}: {
  comparisonLabel: string
  comparisonValue: string
  currentLabel: string
  currentValue: string
  kind: TextFilePreview["kind"]
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!parentRef.current) return

    const readOnlyExtensions = (label: string) => [
      languageExtension(kind),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorView.lineWrapping,
      editorTheme,
    ]
    const mergeView = new MergeView({
      a: {
        doc: comparisonValue,
        extensions: readOnlyExtensions(comparisonLabel),
      },
      b: {
        doc: currentValue,
        extensions: readOnlyExtensions(currentLabel),
      },
      parent: parentRef.current,
      orientation: "a-b",
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: {
        margin: 3,
        minSize: 8,
      },
      diffConfig: {
        timeout: 1_000,
      },
    })

    return () => mergeView.destroy()
  }, [
    comparisonLabel,
    comparisonValue,
    currentLabel,
    currentValue,
    kind,
  ])

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-2 divide-x divide-rule border-b border-rule bg-paper-muted">
        <h3 className="px-3 py-2 font-mono text-[10px] font-bold tracking-[0.04em] uppercase">
          {comparisonLabel}
        </h3>
        <h3 className="px-3 py-2 font-mono text-[10px] font-bold tracking-[0.04em] uppercase">
          {currentLabel}
        </h3>
      </div>
      <div
        className="min-h-0 flex-1 [&_.cm-mergeView]:h-full [&_.cm-mergeView]:overflow-auto [&_.cm-mergeViewEditors]:min-h-full"
        ref={parentRef}
      />
    </section>
  )
}

export function DraftFileEditor({
  file,
  preview,
  basePreview,
  conflictServerPreview,
  diffEntry,
  saving,
  conflict,
  errorMessage,
  onSave,
  onClearError,
}: DraftFileEditorProps) {
  const { t } = useTranslation("versionBrowser")
  const [content, setContent] = useState(preview.content)
  const [mode, setMode] = useState<"edit" | "diff">("edit")

  const unsaved = content !== preview.content
  const comparisonContent =
    conflict && conflictServerPreview
      ? conflictServerPreview.content
      : (basePreview?.content ?? "")
  const comparisonLabel =
    conflict && conflictServerPreview
      ? t("draft.latestServer")
      : diffEntry?.base
        ? t("draft.fixedBasis")
        : t("draft.missingFromBasis")
  const currentLabel = t("draft.localContent")
  const extensions = useMemo(
    () => [
      languageExtension(preview.kind),
      EditorView.lineWrapping,
      editorTheme,
    ],
    [preview.kind],
  )

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-foreground bg-paper-raised px-4">
        <div className="min-w-0">
          <strong className="block truncate font-mono text-xs">
            {file.relativePath}
          </strong>
          <span className="font-mono text-[9px] text-muted-foreground uppercase">
            {unsaved ? t("draft.unsaved") : t("draft.synced")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            className="h-8 rounded-none"
            onClick={() => setMode(mode === "edit" ? "diff" : "edit")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Columns2 aria-hidden="true" data-icon="inline-start" />
            {mode === "edit" ? t("draft.viewDiff") : t("draft.backToEdit")}
          </Button>
          <Button
            className="h-8 rounded-none"
            disabled={!unsaved || saving}
            onClick={() => {
              void onSave(content).catch(() => undefined)
            }}
            size="sm"
            type="button"
          >
            {saving ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <Save aria-hidden="true" data-icon="inline-start" />
            )}
            {t("draft.save")}
          </Button>
        </div>
      </header>

      {errorMessage ? (
        <div
          className="flex items-center justify-between gap-4 border-b border-destructive/60 bg-destructive/5 px-4 py-2 text-xs"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle
              aria-hidden="true"
              className="size-4 shrink-0 text-destructive"
            />
            {conflict
              ? t("draft.conflict")
              : errorMessage}
          </span>
          <button
            className="shrink-0 font-mono text-[10px] underline"
            onClick={onClearError}
            type="button"
          >
            {t("draft.close")}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {mode === "diff" ? (
          <MergeComparison
            comparisonLabel={comparisonLabel}
            comparisonValue={comparisonContent}
            currentLabel={currentLabel}
            currentValue={content}
            kind={preview.kind}
          />
        ) : (
          <CodeMirror
            aria-label={t("draft.editorLabel")}
            basicSetup={{
              autocompletion: false,
              bracketMatching: true,
              closeBrackets: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              lineNumbers: true,
            }}
            extensions={extensions}
            height="100%"
            onChange={setContent}
            value={content}
          />
        )}
      </div>

      {unsaved ? (
        <footer className="flex items-center justify-between border-t border-rule bg-paper-muted px-4 py-2 font-mono text-[10px]">
          <span>{t("draft.saveNotice")}</span>
          <button
            className="inline-flex items-center gap-1 underline"
            onClick={() => setContent(preview.content)}
            type="button"
          >
            <Undo2 aria-hidden="true" className="size-3" />
            {t("draft.discardLocal")}
          </button>
        </footer>
      ) : null}
    </section>
  )
}
