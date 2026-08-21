import { GitCommitVertical, LoaderCircle, Tag } from "lucide-react"
import { useState } from "react"

import type {
  CreateSkillVersionInput,
  SkillVersionBrowser,
} from "@/features/version-browser/model/version-browser"
import type { VersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { SkillConsoleApiError } from "@/shared/api/http"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog"
import { Input } from "@/shared/components/ui/input"

interface CreateVersionDialogProps {
  copy: VersionBrowserCopy
  suggestedName: string
  pending: boolean
  onCreate: (
    input: CreateSkillVersionInput,
  ) => Promise<SkillVersionBrowser>
  onCreated: (version: SkillVersionBrowser) => void
}

export function CreateVersionDialog({
  copy,
  suggestedName,
  pending,
  onCreate,
  onCreated,
}: CreateVersionDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(suggestedName)
  const [description, setDescription] = useState("")
  const [labels, setLabels] = useState("")
  const [setOnline, setSetOnline] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(suggestedName)
      setDescription("")
      setLabels("")
      setSetOnline(false)
    }
    setNameError(null)
    setSubmitError(null)
    setOpen(nextOpen)
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button className="h-9 rounded-xl" type="button">
          <GitCommitVertical aria-hidden="true" data-icon="inline-start" />
          {copy.saveAsVersion}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden rounded-[20px] border-border bg-card p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-rule px-6 py-5">
          <DialogTitle>保存当前工作副本为版本</DialogTitle>
          <DialogDescription>
            版本内容冻结后不可修改；名称、说明和标签仍可维护。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 py-5">
          <div className="grid gap-1.5 text-xs font-semibold">
            <label htmlFor="create-version-name">版本名称</label>
            <Input
              aria-describedby={
                nameError ? "create-version-name-error" : undefined
              }
              aria-invalid={Boolean(nameError)}
              className="rounded-xl"
              id="create-version-name"
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
                setSubmitError(null)
              }}
              value={name}
            />
            {nameError ? (
              <p
                className="text-xs font-normal text-destructive"
                id="create-version-name-error"
                role="alert"
              >
                {nameError}
              </p>
            ) : null}
          </div>
          <label className="grid gap-1.5 text-xs font-semibold">
            说明（可选）
            <textarea
              className="min-h-24 resize-y border border-rule bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Tag aria-hidden="true" className="size-3.5" />
              标签（逗号分隔）
            </span>
            <Input
              className="rounded-xl"
              onChange={(event) => setLabels(event.target.value)}
              placeholder="例如：候选、实验-A"
              value={labels}
            />
          </label>
          <label className="flex items-start gap-2 border border-rule-soft bg-paper-muted px-3 py-3 text-xs">
            <input
              checked={setOnline}
              className="mt-0.5"
              onChange={(event) => setSetOnline(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong className="block">同时标记为当前上线版本</strong>
              <span className="mt-1 block text-muted-foreground">
                仅作上线标记，不代表系统已验收或自动发布。
              </span>
            </span>
          </label>
          {submitError ? (
            <div
              className="border-l-4 border-destructive bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {submitError}
            </div>
          ) : null}
        </div>
        <DialogFooter className="border-t border-rule bg-surface-muted px-6 py-4">
          <DialogClose asChild>
            <Button className="rounded-xl" type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            className="rounded-xl"
            disabled={!name.trim() || pending}
            onClick={() => {
              setNameError(null)
              setSubmitError(null)
              void onCreate({
                name: name.trim(),
                description: description.trim() || null,
                labels: [
                  ...new Set(
                    labels
                      .split(",")
                      .map((label) => label.trim())
                      .filter(Boolean),
                  ),
                ],
                setOnline,
              })
                .then((version) => {
                  setOpen(false)
                  onCreated(version)
                })
                .catch((error: unknown) => {
                  if (
                    error instanceof SkillConsoleApiError &&
                    error.code === "VERSION_NAME_CONFLICT"
                  ) {
                    setNameError("该版本名称已存在，请使用其他名称。")
                    return
                  }
                  setSubmitError(
                    error instanceof Error
                      ? error.message
                      : "版本保存失败，请稍后重试。",
                  )
                })
            }}
            type="button"
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <GitCommitVertical aria-hidden="true" data-icon="inline-start" />
            )}
            确认保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
