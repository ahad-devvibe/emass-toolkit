import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

// Logos exported from Figma (public/brand/): colour for light surfaces, white for dark/navy ones
const COLOR_SRC = "/brand/emass-logo-color.svg"
const WHITE_SRC = "/brand/emass-logo-white.svg"
const ALT = "EMASS, a Nanoveu business"

type BrandLogoProps = {
  to: string
  className?: string
  /** "auto" follows the theme; "light" always uses the white logo (for navy surfaces) */
  tone?: "auto" | "light"
}

export function BrandLogo({ to, className, tone = "auto" }: BrandLogoProps) {
  return (
    <Link to={to} aria-label="EMASS home" className={cn("inline-flex shrink-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      {tone === "light" ? (
        <img src={WHITE_SRC} alt={ALT} width={434} height={175} className="h-auto w-full" />
      ) : (
        <>
          <img src={COLOR_SRC} alt={ALT} width={193} height={77} className="h-auto w-full dark:hidden" />
          <img src={WHITE_SRC} alt={ALT} width={434} height={175} className="hidden h-auto w-full dark:block" />
        </>
      )}
    </Link>
  )
}
