import { LoaderCircle, PencilLine } from "lucide-react"
import { useEffect, useState } from "react"

import type {
  CreateSkillVersionInput,
  SkillVersionBrowser,
} from "@/features/version-browser/model/version-browser"
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

interface VersionMetadataDialogProps {
  version: SkillVersionBrowser
  pending: boolean
  onSave: (
    versionId: string,
    input: Pick<
      CreateSkillVersionInput,
      "name" | "description" | "labels"
    >,
  ) => Promise<SkillVersionBrowser>
}

export function VersionMetadataDialog({
  version,
  pending,
  onSave,
}: VersionMetadataDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(version.name)
  const [description, setDescription] = useState(
    version.description ?? "",
  )
  const [labels, setLabels] = useState(version.labels.join(", "))
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setName(version.name)
      setDescription(version.description ?? "")
      setLabels(version.labels.join(", "))
      setNameError(null)
      setSubmitError(null)
    }
  }, [open, version])

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="h-9 rounded-none" type="button" variant="outline">
          <PencilLine data-icon="inline-start" />
          编辑版本信息
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-rule px-6 py-5">
          <DialogTitle>编辑版本信息</DialogTitle>
          <DialogDescription>
            只修改名称、说明和标签，不会改变已冻结的文件内容。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 py-5">
          <div className="grid gap-1.5 text-xs font-semibold">
            <label htmlFor="edit-version-name">版本名称</label>
            <Input
              aria-describedby={
                nameError ? "edit-version-name-error" : undefined
              }
              aria-invalid={Boolean(nameError)}
              className="rounded-none"
              id="edit-version-name"
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
                id="edit-version-name-error"
                role="alert"
              >
                {nameError}
              </p>
            ) : null}
          </div>
          <label className="grid gap-1.5 text-xs font-semibold">
            说明
            <textarea
              className="min-h-24 resize-y border border-rule bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold">
            标签（逗号分隔）
            <Input
              className="rounded-none"
              onChange={(event) => setLabels(event.target.value)}
              value={labels}
            />
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
        <DialogFooter className="border-t border-rule px-6 py-4">
          <DialogClose asChild>
            <Button className="rounded-none" type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            className="rounded-none"
            disabled={!name.trim() || pending}
            onClick={() => {
              setNameError(null)
              setSubmitError(null)
              void onSave(version.id, {
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
              })
                .then(() => setOpen(false))
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
                      : "版本信息保存失败，请稍后重试。",
                  )
                })
            }}
            type="button"
          >
            {pending ? (
              <LoaderCircle
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <PencilLine data-icon="inline-start" />
            )}
            保存信息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
