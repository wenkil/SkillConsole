import { Settings } from "lucide-react"

import { BrandLockup } from "@/shared/components/layout/brand-lockup"
import { Button } from "@/shared/components/ui/button"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group"
import type { AppLocale } from "@/shared/types/locale"

interface AppHeaderProps {
  locale: AppLocale
  settingsLabel: string
  onLocaleChange: (locale: AppLocale) => void
  onSettingsClick: () => void
}

export function AppHeader({
  locale,
  settingsLabel,
  onLocaleChange,
  onSettingsClick,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--app-header-height)] items-center justify-between border border-foreground bg-paper-raised px-6">
      <BrandLockup />

      <div className="flex items-center gap-2.5">
        <ToggleGroup
          aria-label="Language"
          className="border border-rule"
          onValueChange={(value) => {
            if (value === "en" || value === "zh-CN") {
              onLocaleChange(value)
            }
          }}
          type="single"
          value={locale}
          variant="outline"
        >
          <ToggleGroupItem
            aria-label="English"
            className="h-9 rounded-none border-0 px-3 font-mono text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
            value="en"
          >
            EN
          </ToggleGroupItem>
          <ToggleGroupItem
            aria-label="简体中文"
            className="h-9 rounded-none border-0 px-3 font-mono text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
            value="zh-CN"
          >
            中文
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          className="h-9 rounded-none border-foreground bg-paper-raised px-3.5 font-semibold shadow-none hover:border-primary hover:bg-paper-raised hover:text-signal-dark"
          onClick={onSettingsClick}
          type="button"
          variant="outline"
        >
          <Settings aria-hidden="true" data-icon="inline-start" />
          {settingsLabel}
        </Button>
      </div>
    </header>
  )
}
