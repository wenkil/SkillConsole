import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createInstance } from "i18next"
import { useState } from "react"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { describe, expect, it, vi } from "vitest"

import { DraftFileEditor } from "@/features/version-browser/components/draft-file-editor"
import type {
  SnapshotFile,
  TextFilePreview,
} from "@/features/version-browser/model/version-browser"
import { resources } from "@/shared/i18n/resources"

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    readOnly,
    "aria-label": ariaLabel,
  }: {
    value: string
    onChange?: (value: string) => void
    readOnly?: boolean
    "aria-label"?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
      readOnly={readOnly}
      value={value}
    />
  ),
}))

vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    private readonly nodes: HTMLTextAreaElement[]

    constructor({
      a,
      b,
      parent,
    }: {
      a: { doc?: string }
      b: { doc?: string }
      parent?: Element | DocumentFragment
    }) {
      this.nodes = [a.doc ?? "", b.doc ?? ""].map((value) => {
        const editor = document.createElement("textarea")
        editor.readOnly = true
        editor.value = value
        parent?.append(editor)
        return editor
      })
    }

    destroy() {
      for (const node of this.nodes) node.remove()
    }
  },
}))

const file: SnapshotFile = {
  relativePath: "SKILL.md",
  sha256: "a".repeat(64),
  byteSize: 16,
  mediaTypeHint: "text/markdown",
  contentKind: "text",
  previewKind: "markdown",
  previewable: true,
}

const preview: TextFilePreview = {
  kind: "markdown",
  relativePath: "SKILL.md",
  mediaType: "text/markdown",
  encoding: "utf-8",
  content: "# Original\n",
}

const latestServerPreview: TextFilePreview = {
  ...preview,
  content: "# Server latest\n",
}

const testI18n = createInstance()
void testI18n.use(initReactI18next).init({
  defaultNS: "versionBrowser",
  fallbackLng: "zh-CN",
  initAsync: false,
  lng: "zh-CN",
  resources,
})

function ConflictHarness() {
  const [conflict, setConflict] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  return (
    <DraftFileEditor
      basePreview={preview}
      conflict={conflict}
      conflictServerPreview={conflict ? latestServerPreview : null}
      diffEntry={{
        relativePath: "SKILL.md",
        status: "MODIFIED",
        previewable: true,
        base: {
          sha256: "a".repeat(64),
          byteSize: 16,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
        current: {
          sha256: "b".repeat(64),
          byteSize: 20,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
        ignoredReason: null,
      }}
      errorMessage={errorMessage}
      file={file}
      onClearError={() => {
        setConflict(false)
        setErrorMessage(null)
      }}
      onSave={async () => {
        setConflict(true)
        setErrorMessage("Precondition failed")
        throw new Error("Precondition failed")
      }}
      preview={preview}
      saving={false}
    />
  )
}

describe("DraftFileEditor", () => {
  it("preserves local text after a 412-style conflict and compares it with the latest server content", async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={testI18n}>
        <ConflictHarness />
      </I18nextProvider>,
    )

    const editor = screen.getByRole("textbox", {
      name: "草稿文件编辑器",
    })
    expect(editor.closest("section")).toHaveClass(
      "h-full",
      "overflow-hidden",
    )
    expect(editor.parentElement).toHaveClass("overflow-hidden")
    await user.clear(editor)
    await user.type(editor, "# Local unsaved")
    await user.click(screen.getByRole("button", { name: "保存草稿" }))

    expect(editor).toHaveValue("# Local unsaved")
    expect(
      screen.getByText(/你的本地文本仍保留在编辑器中/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "查看 Diff" }))
    expect(screen.getByText("服务端最新内容")).toBeInTheDocument()
    expect(
      screen
        .getAllByRole("textbox")
        .map((element) => (element as HTMLTextAreaElement).value),
    ).toEqual(["# Server latest\n", "# Local unsaved"])
  })
})
