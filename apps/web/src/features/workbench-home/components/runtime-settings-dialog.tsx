import { Info, Save, Settings } from "lucide-react"

import type { RuntimeDefaults } from "@/features/workbench-home/model/workbench"
import type { WorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { Input } from "@/shared/components/ui/input"
import { Label } from "@/shared/components/ui/label"

interface RuntimeSettingsDialogProps {
  open: boolean
  values: RuntimeDefaults
  copy: WorkbenchHomeCopy
  onOpenChange: (open: boolean) => void
  onValuesChange: (values: RuntimeDefaults) => void
  onSubmit: () => void
}

export function RuntimeSettingsDialog({
  open,
  values,
  copy,
  onOpenChange,
  onValuesChange,
  onSubmit,
}: RuntimeSettingsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 rounded-none border-foreground bg-paper-raised p-0 shadow-[12px_12px_0_rgb(16_24_32/18%)] sm:max-w-xl">
        <DialogHeader className="border-b border-foreground px-5 py-5">
          <DialogTitle className="flex items-center gap-2.5 font-mono text-base">
            <Settings aria-hidden="true" className="size-5 text-primary" />
            {copy.settingsDialogTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {copy.settingsDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5">
          <div className="flex items-start gap-2.5 border border-rule-soft bg-background px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            <Info
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-technical"
            />
            {copy.settingsDescription}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="runtime-endpoint">{copy.endpointUrl}</Label>
            <Input
              className="h-10 rounded-none bg-white/45 shadow-none"
              id="runtime-endpoint"
              onChange={(event) =>
                onValuesChange({
                  ...values,
                  endpointUrl: event.target.value,
                })
              }
              placeholder="https://gateway.example.com/v1"
              type="url"
              value={values.endpointUrl}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="runtime-api-key">{copy.apiKey}</Label>
            <Input
              className="h-10 rounded-none bg-white/45 shadow-none"
              id="runtime-api-key"
              onChange={(event) =>
                onValuesChange({ ...values, apiKey: event.target.value })
              }
              placeholder="••••••••••••••••"
              type="password"
              value={values.apiKey}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="runtime-model-id">{copy.modelId}</Label>
            <Input
              className="h-10 rounded-none bg-white/45 shadow-none"
              id="runtime-model-id"
              onChange={(event) =>
                onValuesChange({ ...values, modelId: event.target.value })
              }
              placeholder="claude-compatible-model"
              value={values.modelId}
            />
          </div>
        </div>

        <DialogFooter className="border-t border-foreground px-5 py-4">
          <DialogClose asChild>
            <Button
              className="rounded-none border-foreground shadow-none"
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            className="rounded-none font-bold shadow-none"
            onClick={onSubmit}
            type="button"
          >
            <Save aria-hidden="true" data-icon="inline-start" />
            {copy.saveSettings}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
