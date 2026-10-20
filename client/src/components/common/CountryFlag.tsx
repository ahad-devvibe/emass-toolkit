import { useFlags } from "@/lib/countries/flags"
import { cn } from "@/lib/utils"

/** Small SVG flag for an ISO alpha-2 code; shows a neutral tile until the flag chunk loads. */
export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const Svg = useFlags()?.[code.toUpperCase()]
  return <span aria-hidden className={cn("inline-flex h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] bg-muted ring-1 ring-foreground/10", className)}>{Svg && <Svg className="size-full" />}</span>
}
