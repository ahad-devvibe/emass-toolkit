import type { CSSProperties } from "react"
import { ArrowRight, BookOpenText, Code2, MonitorSmartphone, type LucideIcon } from "lucide-react"
import { Outlet } from "react-router-dom"
import { ThemeToggle } from "./ThemeToggle"
import { useThemeToggle } from "./useThemeToggle"

// Assets exported from the Figma "SIGNIN" frame (public/auth/)
const LOGO_SRC = "/brand/emass-logo-white.svg"
const CHIP_SRC = "/auth/chip-background.jpg"
const PATTERN_SRC = "/auth/pattern-lines.png"

const highlights: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Code2, title: "Versioned SDKs", text: "Download the version you need." },
  { icon: MonitorSmartphone, title: "Windows, macOS & Ubuntu", text: "Builds for every platform." },
  { icon: BookOpenText, title: "Docs with every release", text: "Guides and release notes for each version." },
]

// The chip photo fades in from the left and from the top over the navy gradient,
// like the two alpha masks in the design
const chipMask: CSSProperties = {
  maskImage: "linear-gradient(to bottom, rgb(0 0 0 / 0.13), #000), linear-gradient(to right, transparent 10%, #000 69%)",
  maskComposite: "intersect",
  WebkitMaskImage: "linear-gradient(to bottom, rgb(0 0 0 / 0.13), #000), linear-gradient(to right, transparent 10%, #000 69%)",
  WebkitMaskComposite: "source-in",
}

// The strip pattern covers the whole page; Figma shows one large slice of it, so it's drawn
// much wider than the screen to keep the strips at the design's scale
const pageStrips: CSSProperties = {
  backgroundImage: `url(${PATTERN_SRC})`,
  backgroundRepeat: "no-repeat",
  backgroundSize: "max(170vw, 1700px) auto",
  backgroundPosition: "30% 60%",
}

function FeatureCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li>
      <div className="flex min-h-[72px] items-center gap-4 rounded-full border border-sky-400/35 bg-sky-600/20 py-2.5 pr-5 pl-3 backdrop-blur-sm transition-colors hover:bg-sky-500/25 short:min-h-[66px] compact:min-h-[60px]">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-[0_4px_16px_rgb(14_165_233/0.3)] short:size-11 compact:size-10">
          <Icon className="size-6 short:size-[22px] compact:size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold leading-tight text-white short:text-base">{title}</p>
          <p className="mt-1 text-sm leading-5 text-blue-100/90 short:text-[13px]">{text}</p>
        </div>
        <ArrowRight aria-hidden className="mr-1 size-5 shrink-0 text-sky-200" />
      </div>
    </li>
  )
}

/**
 * Layout route for every signed-out page (design: Figma "SIGNIN" frame). The
 * brand panel stays mounted with a fixed column split while the pages
 * (AuthCard) swap in the right column, so moving between sign-in and sign-up
 * doesn't shift or repaint the panel.
 */
export function AuthLayout() {
  const { isDark, toggleTheme } = useThemeToggle()

  return (
    // Desktop: exactly one screen tall, no page scroll. Phones keep normal page flow.
    <div className="relative isolate grid min-h-dvh gap-3.5 bg-[#e7f6ff] p-3 text-foreground sm:p-5 lg:h-dvh lg:overflow-hidden xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] 2xl:grid-cols-2 dark:bg-gradient-to-b dark:from-[#0b2147] dark:to-[#06142c]">
      {/* Page-wide strips behind both panels; fixed so they stay put while phones scroll. Dark mode keeps them faint */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 dark:opacity-60 dark:brightness-[1.4] dark:saturate-110" style={pageStrips} />
      {/* Brand panel; shrinks its type and spacing on short screens (see `short:` in index.css) */}
      <section className="relative hidden overflow-hidden rounded-[48px] bg-gradient-to-b from-[#0f3678] to-[#001a46] px-14 py-10 text-white short:py-8 compact:py-6 xl:flex xl:flex-col xl:rounded-[59px] xl:px-[70px]">
        <img aria-hidden src={CHIP_SRC} alt="" className="pointer-events-none absolute inset-0 size-full object-cover object-[25%_40%]" style={chipMask} />
        <img src={LOGO_SRC} alt="EMASS, a Nanoveu business" width={434} height={175} className="relative mt-5 h-auto w-[min(250px,48%)] short:mt-4 short:w-[min(225px,44%)] compact:mt-3 compact:w-[min(190px,40%)]" />
        <div className="relative mt-16 ml-4 w-full max-w-[680px] short:mt-12 compact:mt-9 xl:ml-5">
          <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-sky-200 short:mb-2 compact:text-[11px]">WELCOME TO THE</p>
          <h1 className="font-display text-[44px] font-semibold leading-[1.08] tracking-tight text-white short:text-[39px] compact:text-[34px] xl:whitespace-nowrap xl:text-[48px] xl:short:text-[42px] xl:compact:text-[36px]">
            EMASS <span className="text-white">Portal</span>
          </h1>
          <p className="mt-4 max-w-[530px] font-display text-lg leading-[1.55] text-blue-100/90 short:mt-3 short:text-base compact:mt-2.5">Access SDKs, drivers and technical documentation for EMASS hardware. Build, integrate and innovate with confidence.</p>
          <ul className="mt-12 max-w-[470px] space-y-4 short:mt-8 short:space-y-3 compact:mt-6 compact:space-y-2.5">
            {highlights.map((item) => <FeatureCard key={item.title} {...item} />)}
          </ul>
        </div>
      </section>

      {/* Form panel: no card of its own; the form sits straight on the page strips */}
      <section className="relative flex min-h-0 flex-col overflow-hidden">
        {/* The theme toggle stays in the top bar; the auth logo is shown above the form heading. */}
        <div className="relative flex items-center px-4 pt-6 sm:px-10 tiny:pt-3 xl:absolute xl:top-6 xl:right-8 xl:z-10 xl:p-0">
          <div className="ml-auto"><ThemeToggle isDark={isDark} onToggle={toggleTheme} /></div>
        </div>
        {/* If a form is taller than the screen, this panel scrolls inside itself, never the page */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-10">
          <Outlet />
        </div>
      </section>
    </div>
  )
}
