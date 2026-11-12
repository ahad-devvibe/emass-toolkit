import { useFlags } from "@/lib/countries/flags"
import { cn } from "@/lib/utils"

/**
 * Small SVG flag for an ISO alpha-2 code. Until the flag chunk loads, or if
 * there is no flag for the code, the code itself shows in a bordered tile,
 * so the slot is never blank (an empty muted tile vanished on dark dialogs).
 */
export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const Svg = useFlags()?.[code.toUpperCase()]
  if (!Svg) {
    return <span aria-hidden className={cn("inline-flex h-3.5 min-w-5 shrink-0 items-center justify-center rounded-[3px] px-0.5 text-[8px] font-semibold leading-none text-muted-foreground ring-1 ring-foreground/20", className, "w-auto")}>{code.toUpperCase()}</span>
  }
  return <span aria-hidden className={cn("inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] bg-muted ring-1 ring-foreground/10", className)}><Svg className="size-full" /></span>
}
