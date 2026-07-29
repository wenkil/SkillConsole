import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { EditorView } from "@codemirror/view"
import CodeMirror from "@uiw/react-codemirror"
import {
  AlertTriangle,
  LoaderCircle,
  Save,
  Undo2,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { SnapshotFile, TextFilePreview } from "@/features/version-browser/model/version-browser"
import { DraftFileDeleteButton } from "@/features/version-browser/components/draft-file-delete-button"
import { Button } from "@/shared/components/ui/button"

interface DraftFileEditorProps {
  file: SnapshotFile
  preview: TextFilePreview
  saving: boolean
  conflict: boolean
  errorMessage: string | null
  onDelete: () => Promise<void>
  onSave: (content: string) => Promise<void>
  onClearError: () => void
  /** @deprecated Draft-to-basis comparison was removed. */
  basePreview?: TextFilePreview | null
  /** @deprecated Draft-to-basis comparison was removed. */
  conflictServerPreview?: TextFilePreview | null
  /** @deprecated Draft-to-basis comparison was removed. */
  diffEntry?: unknown
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
    backgroundColor: "var(--paper-raised)",
    color: "var(--foreground)",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overflow: "auto",
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

export function DraftFileEditor({
  file,
  preview,
  saving,
  conflict,
  errorMessage,
  onDelete,
  onSave,
  onClearError,
}: DraftFileEditorProps) {
  const { t } = useTranslation("versionBrowser")
  const [content, setContent] = useState(preview.content)

  const unsaved = content !== preview.content
  const extensions = useMemo(
    () => [
      languageExtension(preview.kind),
      EditorView.lineWrapping,
      editorTheme,
    ],
    [preview.kind],
  )

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-foreground bg-paper-raised px-4">
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
          <DraftFileDeleteButton
            file={file}
            onDeleteFile={onDelete}
            pending={saving}
          />
        </div>
      </header>

      {errorMessage ? (
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/60 bg-destructive/5 px-4 py-2 text-xs"
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

      <div className="min-h-0 flex-1 overflow-hidden">
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
          className="h-full overflow-hidden"
          extensions={extensions}
          height="100%"
          onChange={setContent}
          value={content}
        />
      </div>

      {unsaved ? (
        <footer className="flex shrink-0 items-center justify-between border-t border-rule bg-paper-muted px-4 py-2 font-mono text-[10px]">
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
