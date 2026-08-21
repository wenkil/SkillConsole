import type { LucideIcon } from "lucide-react"

interface ModulePlaceholderProps {
  icon: LucideIcon
  eyebrow: string
  title: string
  description: string
  status: string
  plannedStage: string
  plannedLabel: string
}

export function ModulePlaceholder({
  icon: Icon,
  eyebrow,
  title,
  description,
  status,
  plannedStage,
  plannedLabel,
}: ModulePlaceholderProps) {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto px-8 py-8 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-border pb-6">
          <div className="ui-label text-signal-dark">
            {eyebrow}
          </div>
          <h1 className="font-display mt-2 text-[clamp(2rem,3vw,2.8rem)] leading-none font-semibold tracking-[-0.035em]">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </header>

        <section className="mt-7 rounded-2xl border border-border bg-paper-raised p-7 shadow-[var(--surface-shadow)]">
          <Icon
            aria-hidden="true"
            className="size-9 text-technical"
            strokeWidth={1.6}
          />
          <strong className="mt-6 block text-lg">{status}</strong>
          <div className="mt-5 border-t border-border-subtle pt-4">
            <span className="ui-label block">
              {plannedLabel}
            </span>
            <span className="mt-1.5 block text-[13px] font-semibold">
              {plannedStage}
            </span>
          </div>
        </section>
      </div>
    </main>
  )
}
