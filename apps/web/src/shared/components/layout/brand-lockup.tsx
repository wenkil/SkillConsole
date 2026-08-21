import { Ruler } from "lucide-react"

export function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-primary/8 text-primary">
        <Ruler aria-hidden="true" className="size-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[17px] font-extrabold tracking-[-0.035em]">
          SkillConsole
        </p>
        <p className="truncate text-[10px] leading-4 tracking-[0.01em] text-muted-foreground">
          Skill quality measurement workbench
        </p>
      </div>
    </div>
  )
}
