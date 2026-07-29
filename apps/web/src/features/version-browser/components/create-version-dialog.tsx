import { GitCommitVertical, LoaderCircle, Tag } from "lucide-react"
import { useState } from "react"

import type {
  CreateSkillVersionInput,
  SkillVersionBrowser,
} from "@/features/version-browser/model/version-browser"
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
  suggestedName: string
  pending: boolean
  onCreate: (
    input: CreateSkillVersionInput,
  ) => Promise<SkillVersionBrowser>
  onCreated: (version: SkillVersionBrowser) => void
}

export function CreateVersionDialog({
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

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="h-9 rounded-none" type="button">
          <GitCommitVertical aria-hidden="true" data-icon="inline-start" />
          保存为版本
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-rule px-6 py-5">
          <DialogTitle>保存当前工作副本为版本</DialogTitle>
          <DialogDescription>
            版本内容冻结后不可修改；名称、说明和标签仍可维护。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 py-5">
          <label className="grid gap-1.5 text-xs font-semibold">
            版本名称
            <Input
              className="rounded-none"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
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
              className="rounded-none"
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
                这是用户标注，不代表系统验收通过或自动发布。
              </span>
            </span>
          </label>
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
                .catch(() => undefined)
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
