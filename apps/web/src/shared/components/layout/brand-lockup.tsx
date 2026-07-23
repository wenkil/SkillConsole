import { Ruler } from "lucide-react"

export function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center border border-foreground bg-background text-primary">
        <Ruler aria-hidden="true" className="size-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="truncate font-mono text-[17px] font-bold tracking-[0.035em]">
          SKILLCONSOLE
        </p>
        <p className="truncate font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
          Skill quality measurement workbench
        </p>
      </div>
    </div>
  )
}
