import { FileCheck2, Layers, Lock, Package } from "lucide-react"
import { Outlet } from "react-router-dom"
import { ThemeToggle } from "./ThemeToggle"
import { useThemeToggle } from "./useThemeToggle"

const highlights = [
  { icon: Layers, title: "Versioned SDKs", text: "Every release stays available, so you can pin the build you ship." },
  { icon: FileCheck2, title: "SHA-256 verified", text: "Checksums sit next to every file for integrity checks." },
  { icon: Lock, title: "Private downloads", text: "Files live in a private bucket behind short-lived links." },
]

/**
 * Layout route for every signed-out page. The brand panel stays mounted with a
 * fixed column split while the pages (AuthCard) swap in the right column, so
 * moving between sign-in and sign-up doesn't shift or repaint the panel.
 */
export function AuthLayout() {
  const { isDark, toggleTheme } = useThemeToggle()

  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="relative hidden overflow-hidden bg-brand-gradient-deep p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute inset-0 bg-grid-dots [mask-image:linear-gradient(to_top,black,transparent_80%)]" />
        <div aria-hidden className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-sky/40 blur-3xl" />
        <div className="relative flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-lg bg-white/15 ring-1 ring-white/25"><Package className="size-4" /></span>
          EMASS <span className="font-normal text-white/70">Portal</span>
        </div>
        <div className="relative my-auto max-w-md space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-powder">Smarter · Faster · Greener</p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight">EMASS developer portal</h1>
            <p className="text-sm leading-6 text-white/80">Drivers, SDKs and tools for building on EMASS edge-AI hardware.</p>
          </div>
          <ul className="space-y-4">
            {highlights.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15"><Icon className="size-4" /></span>
                <div><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-sm text-white/75">{text}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">© 2026 Nanoveu · EMASS developer portal</p>
      </section>

      <section className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center">
          <span className="flex items-center gap-2.5 font-semibold tracking-tight lg:invisible">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Package className="size-4" /></span>
            EMASS <span className="font-normal text-muted-foreground">Portal</span>
          </span>
          <div className="ml-auto"><ThemeToggle isDark={isDark} onToggle={toggleTheme} /></div>
        </div>
        <Outlet />
      </section>
    </div>
  )
}
