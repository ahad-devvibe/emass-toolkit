import { useState, type ReactNode } from "react"
import { ArrowDownToLine, LifeBuoy, Moon, Monitor, Package, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

function readSavedTheme() {
  const isDark = localStorage.getItem("emass-theme") === "dark"
  document.documentElement.classList.toggle("dark", isDark)
  return isDark
}

const navItem = "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200"
const navIdle = "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
const navActive = "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"

function Avatar({ className }: { className?: string }) {
  return <span className={cn("grid place-items-center rounded-full bg-brand-gradient-deep text-xs font-semibold text-white ring-2 ring-brand-powder dark:ring-brand-blue/50", className)}>AM</span>
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-sidebar md:block">
      <div aria-hidden className="absolute inset-y-0 right-0 w-[3px] bg-brand-edge dark:opacity-80" />
      <div className="flex h-full flex-col pr-[3px]">
        <div className="flex h-16 items-center gap-2.5 px-6 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-gradient-deep text-white shadow-md shadow-brand-blue/30"><Package className="size-4" /></span>
          EMASS <span className="font-normal text-muted-foreground">Portal</span>
        </div>
        <nav aria-label="Main navigation" className="space-y-1 px-3 py-5">
          <p className="px-3 pb-2 pt-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">WORKSPACE</p>
          <a href="#catalog" aria-current="page" className={cn(navItem, navActive)}><Monitor className="size-4 text-primary" />Overview</a>
          <a href="#catalog" className={cn(navItem, navIdle)}><Package className="size-4" />SDK catalog<span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">2</span></a>
          <a href="#downloads" className={cn(navItem, navIdle)}><ArrowDownToLine className="size-4" />Downloads</a>
          <p className="px-3 pb-2 pt-7 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">SUPPORT</p>
          <a href="#support" className={cn(navItem, navIdle)}><LifeBuoy className="size-4" />Help center</a>
        </nav>
        <div className="mt-auto border-t p-4">
          <div className="flex items-center gap-3"><Avatar className="size-9" /><div><p className="text-sm font-medium">Alex Morgan</p><p className="text-xs text-muted-foreground">Nanoveu Systems</p></div></div>
        </div>
      </div>
    </aside>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(readSavedTheme)

  function toggleTheme() {
    const nextIsDark = !isDark
    document.documentElement.classList.toggle("dark", nextIsDark)
    localStorage.setItem("emass-theme", nextIsDark ? "dark" : "light")
    setIsDark(nextIsDark)
  }

  return (
    <TooltipProvider>
      <div className="relative isolate min-h-screen bg-background text-foreground">
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(55%_100%_at_75%_0%,color-mix(in_oklch,var(--brand-sky)_16%,transparent),transparent)]" />
        <Sidebar />
        <div className="md:pl-60">
          <header className="sticky top-0 z-20 flex h-14 items-center bg-background/75 px-6 backdrop-blur-md sm:px-10">
            <p className="text-sm text-muted-foreground">Workspace <span className="px-2">/</span><span className="font-medium text-foreground">Overview</span></p>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-success motion-safe:animate-pulse" />Customer account</span>
              <Button size="icon" variant="ghost" aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>{isDark ? <Sun /> : <Moon />}</Button>
              <Avatar className="size-8" />
            </div>
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-brand-gradient opacity-60" />
          </header>
          {children}
        </div>
        <Toaster theme={isDark ? "dark" : "light"} />
      </div>
    </TooltipProvider>
  )
}
