import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ConfirmationDialog } from "@/shared/components/confirmation-dialog"

describe("ConfirmationDialog", () => {
  it("renders caller-provided copy and invokes the confirmation callback", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ConfirmationDialog
        cancelLabel="取消"
        confirmLabel="确认保存"
        description="保存后不可修改。"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        title="确认保存测试用例"
      />,
    )

    expect(
      screen.getByRole("heading", { name: "确认保存测试用例" }),
    ).toBeInTheDocument()
    expect(screen.getByText("保存后不可修改。")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "确认保存" }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("delegates cancellation to the caller without invoking confirmation", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ConfirmationDialog
        cancelLabel="取消"
        confirmLabel="确认保存"
        description="保存后不可修改。"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        title="确认保存测试用例"
      />,
    )

    await user.click(screen.getByRole("button", { name: "取消" }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
