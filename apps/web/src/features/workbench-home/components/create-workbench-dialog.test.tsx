import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { act } from "react"
import { describe, expect, it, vi } from "vitest"

import { CreateWorkbenchDialog } from "@/features/workbench-home/components/create-workbench-dialog"
import { createEmptyWorkbenchDraft } from "@/features/workbench-home/model/workbench"
import { getWorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { i18n } from "@/shared/i18n/i18n"

const copy = getWorkbenchHomeCopy(
  i18n.getFixedT("zh-CN", "workbenchHome"),
)

describe("CreateWorkbenchDialog", () => {
  it("shows a busy state while a selected folder is being prepared", async () => {
    let finishSelection: (() => void) | undefined
    const onSourceSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSelection = resolve
        }),
    )

    render(
      <CreateWorkbenchDialog
        copy={copy}
        draft={createEmptyWorkbenchDraft()}
        errors={{}}
        folderPolicyStatus="ready"
        onNameChange={vi.fn()}
        onOpenChange={vi.fn()}
        onSourceKindChange={vi.fn()}
        onSourceSelect={onSourceSelect}
        onSubmit={vi.fn()}
        open
        submitting={false}
      />,
    )

    const sourceInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )
    expect(sourceInput).not.toBeNull()

    const file = new File(["# Skill"], "SKILL.md", {
      type: "text/markdown",
    })
    fireEvent.change(sourceInput!, {
      target: {
        files: [file],
      },
    })

    expect(
      await screen.findByText("正在读取并整理文件"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("文件较多时可能需要一些时间，请稍候。"),
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true")
    expect(
      screen.getByRole("button", {
        name: copy.createWorkbenchAndCandidate,
      }),
    ).toBeDisabled()
    await waitFor(() => expect(onSourceSelect).toHaveBeenCalledWith([file]))

    await act(async () => {
      finishSelection?.()
    })

    await waitFor(() => {
      expect(
        screen.queryByText("正在读取并整理文件"),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false")
  })

  it("shows an upload state while the workbench is being created", () => {
    const file = new File(["# Skill"], "SKILL.md", {
      type: "text/markdown",
    })

    render(
      <CreateWorkbenchDialog
        copy={copy}
        draft={{
          ...createEmptyWorkbenchDraft(),
          source: {
            name: "invoice-skill",
            files: [file],
            fileCount: 1,
            ignoredFileCount: 0,
            totalBytes: file.size,
            maxDepth: 1,
          },
        }}
        errors={{}}
        folderPolicyStatus="ready"
        onNameChange={vi.fn()}
        onOpenChange={vi.fn()}
        onSourceKindChange={vi.fn()}
        onSourceSelect={vi.fn()}
        onSubmit={vi.fn()}
        open
        submitting
      />,
    )

    expect(
      screen.getByText("正在上传并创建工作台"),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "正在传输文件、生成 Manifest 并保存初始候选，请勿关闭窗口。",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true")
  })
})
