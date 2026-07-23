import { cn } from "@/shared/lib/utils"

interface TechnicalRulerProps {
  orientation: "horizontal" | "vertical"
  tickCount?: number
  className?: string
}

export function TechnicalRuler({
  orientation,
  tickCount = 64,
  className,
}: TechnicalRulerProps) {
  const ticks = Array.from({ length: tickCount }, (_, index) => index)

  if (orientation === "vertical") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-5 overflow-hidden border-r border-rule-soft",
          className,
        )}
      >
        {ticks.map((index) => (
          <span
            className={cn(
              "absolute left-0 h-px bg-rule",
              index % 5 === 0 ? "w-3.5" : "w-2",
            )}
            key={index}
            style={{ top: `${index * 14 + 8}px` }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative h-6 overflow-hidden border-b border-rule-soft",
        className,
      )}
    >
      {ticks.map((index) => (
        <span
          className={cn(
            "absolute top-1.5 w-px bg-rule",
            index % 5 === 0 ? "h-3" : "h-1.5",
          )}
          key={index}
          style={{ left: `${(index / (tickCount - 1)) * 100}%` }}
        />
      ))}
    </div>
  )
}
