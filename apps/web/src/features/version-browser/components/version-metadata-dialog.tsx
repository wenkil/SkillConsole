import { LoaderCircle, PencilLine } from "lucide-react"
import { useEffect, useState } from "react"

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
  useEffect(() => {
    if (!open) {
      setName(version.name)
      setDescription(version.description ?? "")
      setLabels(version.labels.join(", "))
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
                .catch(() => undefined)
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
