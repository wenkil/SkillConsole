import { BrandLockup } from "@/shared/components/layout/brand-lockup"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group"
import type { AppLocale } from "@/shared/types/locale"

interface AppHeaderProps {
  locale: AppLocale
  onLocaleChange: (locale: AppLocale) => void
}

export function AppHeader({
  locale,
  onLocaleChange,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--app-header-height)] min-w-0 items-center justify-between border-b border-border bg-card px-5">
      <BrandLockup />

      <div className="flex items-center gap-2.5">
        <ToggleGroup
          aria-label="Language"
          className="rounded-[10px] border border-border bg-muted p-0.5"
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
            className="h-8 rounded-lg border-0 px-3 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            value="en"
          >
            EN
          </ToggleGroupItem>
          <ToggleGroupItem
            aria-label="简体中文"
            className="h-8 rounded-lg border-0 px-3 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            value="zh-CN"
          >
            中文
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </header>
  )
}
