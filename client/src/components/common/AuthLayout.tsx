import type { CSSProperties } from "react"
import { BookOpenText, MonitorSmartphone, PackageCheck, type LucideIcon } from "lucide-react"
import { Outlet } from "react-router-dom"
import { ThemeToggle } from "./ThemeToggle"
import { useThemeToggle } from "./useThemeToggle"

// Assets exported from the Figma "SIGNIN" frame (public/auth/)
const LOGO_SRC = "/auth/emass-logo.svg"
const CHIP_SRC = "/auth/chip-background.jpg"
const PATTERN_SRC = "/auth/pattern-lines.png"

const highlights: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: PackageCheck, title: "Versioned SDKs", text: "Every release stays available, so you can pin the build you ship." },
  { icon: MonitorSmartphone, title: "Windows, macOS & Ubuntu", text: "Each release ships builds for every platform you develop on." },
  { icon: BookOpenText, title: "Docs with every release", text: "User guides, evaluation board guides and release notes for each version." },
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

// Card with a round notch on the left that the icon badge sits in
const notchMask = "radial-gradient(circle at 5px 50%, transparent 32px, #000 33px)"

function FeatureCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li className="relative">
      <span aria-hidden className="absolute left-0 top-1/2 z-10 grid size-[52px] -translate-y-1/2 place-items-center rounded-full bg-[#49a6d5] text-white shadow-[0_0_0_4px_rgb(9_118_188/0.25)]">
        <Icon className="size-[26px]" strokeWidth={1.75} />
      </span>
      <div className="ml-[21px] flex min-h-[104px] flex-col justify-center short:min-h-[92px] compact:min-h-[80px] compact:py-3 rounded-l-[10px] rounded-r-[36px] bg-[#0976bc]/47 py-4 pr-6 pl-[47px] backdrop-blur-[2px]" style={{ maskImage: notchMask, WebkitMaskImage: notchMask }}>
        <p className="font-display text-[22px] font-medium leading-tight text-white compact:text-lg">{title}</p>
        <p className="mt-1.5 text-sm leading-[18px] text-[#dfdfdf]">{text}</p>
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
        <img src={LOGO_SRC} alt="EMASS, a Nanoveu business" width={434} height={175} className="relative h-auto w-[min(434px,70%)] short:w-[min(320px,55%)] compact:w-[min(250px,45%)]" />
        <div className="relative my-auto max-w-[640px] py-6 short:py-5 compact:py-3">
          <p className="font-display text-lg font-medium tracking-[6px] text-[#dfdfdf] short:text-base compact:text-sm compact:tracking-[5px]">SMARTER . FASTER . GREENER</p>
          <h1 className="mt-2 font-display text-[44px] font-medium leading-[1.1] short:text-[38px] compact:text-[34px] xl:whitespace-nowrap xl:text-[50px] xl:short:text-[42px] xl:compact:text-[36px]">EMASS developer portal</h1>
          <p className="mt-3 font-display text-lg font-medium text-[#dfdfdf] short:text-base">Drivers, SDKs and tools for building on EMASS edge-AI hardware.</p>
          <ul className="mt-14 max-w-[443px] space-y-8 short:mt-8 short:space-y-4 compact:mt-5 compact:space-y-3">
            {highlights.map((item) => <FeatureCard key={item.title} {...item} />)}
          </ul>
        </div>
      </section>

      {/* Form panel: no card of its own; the form sits straight on the page strips */}
      <section className="relative flex min-h-0 flex-col overflow-hidden">
        {/* Below lg the brand panel is hidden, so show the logo on a navy chip; on desktop only the toggle floats in the corner */}
        <div className="relative flex items-center px-4 pt-6 sm:px-10 tiny:pt-3 xl:absolute xl:top-6 xl:right-8 xl:z-10 xl:p-0">
          <span className="rounded-2xl bg-gradient-to-b from-[#0f3678] to-[#001a46] px-3 py-2 tiny:py-1.5 xl:hidden dark:ring-1 dark:ring-white/10">
            <img src={LOGO_SRC} alt="EMASS, a Nanoveu business" width={434} height={175} className="h-auto w-28 tiny:w-24" />
          </span>
          <div className="ml-auto"><ThemeToggle isDark={isDark} onToggle={toggleTheme} /></div>
        </div>
        {/* If a form is taller than the screen, this panel scrolls inside itself, never the page */}
        <div className="auth-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-10">
          <Outlet />
        </div>
      </section>
    </div>
  )
}
