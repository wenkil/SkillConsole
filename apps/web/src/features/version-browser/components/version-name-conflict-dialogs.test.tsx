import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { CreateVersionDialog } from "@/features/version-browser/components/create-version-dialog"
import { VersionMetadataDialog } from "@/features/version-browser/components/version-metadata-dialog"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
import { SkillConsoleApiError } from "@/shared/api/http"

function versionNameConflict() {
  return new SkillConsoleApiError(409, {
    error: {
      code: "VERSION_NAME_CONFLICT",
      message: "This workbench already contains a version with that name.",
    },
  })
}

const version: SkillVersionBrowser = {
  id: "01900000-0000-7000-8000-000000000101",
  sequenceNumber: 1,
  name: "V1",
  description: null,
  labels: [],
  sourceType: "folder",
  sourceName: "skill",
  createdAt: "2026-07-29T01:00:00.000Z",
  frozenAt: "2026-07-29T01:00:00.000Z",
  isOnline: false,
  isComparisonBaseline: false,
  snapshot: {
    id: "01900000-0000-7000-8000-000000000201",
    state: "READY",
    manifestHash: "a".repeat(64),
    fileCount: 2,
    totalBytes: 24,
    createdAt: "2026-07-29T01:00:00.000Z",
  },
}

describe("version name conflict dialogs", () => {
  it("shows a duplicate create-version name as an inline field error", async () => {
    const user = userEvent.setup()
    render(
      <CreateVersionDialog
        onCreate={vi.fn().mockRejectedValue(versionNameConflict())}
        onCreated={vi.fn()}
        pending={false}
        suggestedName="V2"
      />,
    )

    await user.click(screen.getByRole("button", { name: "保存为版本" }))
    const nameInput = screen.getByRole("textbox", { name: "版本名称" })
    await user.clear(nameInput)
    await user.type(nameInput, "V1")
    await user.click(screen.getByRole("button", { name: "确认保存" }))

    expect(
      await screen.findByText("该版本名称已存在，请使用其他名称。"),
    ).toBeInTheDocument()
    expect(nameInput).toHaveAttribute("aria-invalid", "true")
    expect(
      screen.queryByText(
        "This workbench already contains a version with that name.",
      ),
    ).not.toBeInTheDocument()

    await user.type(nameInput, "-new")
    expect(
      screen.queryByText("该版本名称已存在，请使用其他名称。"),
    ).not.toBeInTheDocument()
    expect(nameInput).toHaveAttribute("aria-invalid", "false")
  })

  it("uses the same inline error when renaming an existing version", async () => {
    const user = userEvent.setup()
    render(
      <VersionMetadataDialog
        onSave={vi.fn().mockRejectedValue(versionNameConflict())}
        pending={false}
        version={version}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "编辑版本信息" }),
    )
    await user.click(screen.getByRole("button", { name: "保存信息" }))

    expect(
      await screen.findByText("该版本名称已存在，请使用其他名称。"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "版本名称" }),
    ).toHaveAttribute("aria-invalid", "true")
  })
})
