import { useState } from "react"
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Copy,
  FileArchive,
  LifeBuoy,
  Moon,
  Monitor,
  Package,
  ShieldCheck,
  Sun,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"

type Product = {
  name: string
  description: string
  version: string
  file: string
  size: string
  checksum: string
  command: string
  platforms: string[]
  notes: string[]
  icon: typeof Monitor
  imageUrl: string
}

const products: Product[] = [
  {
    name: "EMASS Core SDK",
    description: "Essential drivers and tools to integrate EMASS devices into your product.",
    version: "2.4.0",
    file: "emass-core-sdk-2.4.0.zip",
    size: "184 MB",
    checksum: "a84f9e6a1d72b51c0f4b3ed6e2a97cf8c34a5f07e896b2b167ef230d128bc965",
    command: "npm install @emass/core-sdk@2.4.0",
    platforms: ["Windows", "macOS", "Linux"],
    notes: ["Updated device discovery", "Improved USB stability", "Includes CLI tools"],
    icon: Monitor,
    imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "EMASS Vision SDK",
    description: "Computer vision libraries and calibrated drivers for EMASS imaging hardware.",
    version: "1.8.2",
    file: "emass-vision-sdk-1.8.2.zip",
    size: "247 MB",
    checksum: "7d5c8e1b2a94f0d3cf56e719c4a80b6e47d5fc86af01b3248c194ed719a250df",
    command: "npm install @emass/vision-sdk@1.8.2",
    platforms: ["Windows", "Linux"],
    notes: ["New calibration utilities", "Faster frame pipeline", "NVIDIA runtime support"],
    icon: Package,
    imageUrl: "https://images.unsplash.com/photo-1535378917042-10a22c95931a?auto=format&fit=crop&w=1200&q=80",
  },
]

const recentDownloads = [
  { name: "EMASS Core SDK", version: "v2.4.0", date: "Today, 10:42 AM" },
  { name: "EMASS Vision SDK", version: "v1.8.1", date: "October 04, 2026" },
]

function readSavedTheme() {
  const savedTheme = localStorage.getItem("emass-theme")
  const isDark = savedTheme === "dark"
  document.documentElement.classList.toggle("dark", isDark)
  return isDark
}

function App() {
  const [isDark, setIsDark] = useState(readSavedTheme)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)

  function toggleTheme() {
    const nextIsDark = !isDark
    document.documentElement.classList.toggle("dark", nextIsDark)
    localStorage.setItem("emass-theme", nextIsDark ? "dark" : "light")
    setIsDark(nextIsDark)
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(label + " copied to clipboard")
    } catch {
      toast.error("Clipboard access is unavailable in this browser")
    }
  }

  function download(file: string) {
    toast.success(file + " is ready to download")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-background md:block">
        <div className="flex h-16 items-center gap-2 border-b px-6 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Package className="size-4" />
          </span>
          EMASS <span className="font-normal text-muted-foreground">Portal</span>
        </div>
        <nav aria-label="Main navigation" className="space-y-1 px-3 py-5">
          <p className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">WORKSPACE</p>
          <a href="#catalog" aria-current="page" className="flex h-9 items-center gap-3 rounded-md bg-accent px-3 text-sm font-medium">
            <Monitor className="size-4" />Overview
          </a>
          <a href="#catalog" className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Package className="size-4" />SDK catalog
            <span className="ml-auto text-xs">2</span>
          </a>
          <a href="#downloads" className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowDownToLine className="size-4" />Downloads
          </a>
          <p className="px-3 pb-2 pt-7 text-xs font-medium text-muted-foreground">SUPPORT</p>
          <a href="#support" className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <LifeBuoy className="size-4" />Help center
          </a>
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-muted text-xs font-medium">AM</span>
            <div><p className="text-sm font-medium">Alex Morgan</p><p className="text-xs text-muted-foreground">Nanoveu Systems</p></div>
          </div>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center border-b bg-background/95 px-6 backdrop-blur sm:px-10">
          <p className="text-sm text-muted-foreground">Workspace <span className="px-2">/</span><span className="text-foreground">Overview</span></p>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex"><span className="size-2 rounded-full bg-emerald-500" />Customer account</span>
            <Button size="icon" variant="ghost" aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>
              {isDark ? <Sun /> : <Moon />}
            </Button>
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium">AM</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl space-y-12 px-6 py-10 sm:px-10 lg:px-12">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Customer portal</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">SDK catalog</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Download drivers and tools for your EMASS products.</p>
          </div>

          <section id="catalog" className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Available SDKs</h2>
              <p className="mt-1 text-sm text-muted-foreground">The latest stable releases for your workspace.</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {products.map((product) => {
                const Icon = product.icon
                return (
                  <Card key={product.name} className="transition-shadow hover:shadow-sm">
                    <div className="relative h-48 overflow-hidden rounded-t-xl border-b bg-muted/40 sm:h-56">
                      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary/10 via-muted to-primary/5 text-primary">
                        <Icon className="size-16 opacity-30" strokeWidth={1.2} />
                      </div>
                      <img
                        src={product.imageUrl}
                        alt={`${product.name} product preview`}
                        className="relative h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                        onError={(event) => {
                          event.currentTarget.style.display = "none"
                        }}
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                      <div className="absolute inset-x-5 bottom-4 flex items-center justify-between gap-3 text-white">
                        <span className="rounded-full border border-white/30 bg-black/25 px-2.5 py-1 text-xs font-medium backdrop-blur">EMASS product</span>
                        <span className="rounded-full border border-white/30 bg-black/25 px-2.5 py-1 text-xs backdrop-blur">v{product.version}</span>
                      </div>
                    </div>
                    <CardHeader className="gap-4 p-6 sm:p-7">
                      <div className="flex items-start gap-4">
                        <div className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted/50 text-primary"><Icon className="size-5" /></div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle>{product.name}</CardTitle>
                            <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">v{product.version}</span>
                          </div>
                          <CardDescription className="leading-5">{product.description}</CardDescription>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />Stable</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
                      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span><Monitor className="mr-1.5 inline size-3.5" />{product.platforms.join(" · ")}</span>
                        <span><FileArchive className="mr-1.5 inline size-3.5" />{product.size}</span>
                      </div>
                      <Separator />
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Button variant="outline" onClick={() => setActiveProduct(product)}>Release details</Button>
                        <Button onClick={() => download(product.file)}><ArrowDownToLine />Download SDK</Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Release files are private and checksum verified.</p>
          </section>

          <section id="downloads" className="space-y-4">
            <div><h2 className="text-lg font-semibold tracking-tight">Recent downloads</h2><p className="mt-1 text-sm text-muted-foreground">Your latest activity in this workspace.</p></div>
            <Card><CardContent className="divide-y p-0">{recentDownloads.map((item) => <div key={item.name} className="flex items-center gap-4 px-6 py-4 sm:py-5"><span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/40"><ArrowDownToLine className="size-4 text-muted-foreground" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.name} <span className="font-normal text-muted-foreground">{item.version}</span></p><p className="mt-1 text-xs text-muted-foreground">{item.date}</p></div><CheckCircle2 className="size-4 text-emerald-600" /></div>)}</CardContent></Card>
          </section>

          <section id="support" className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium">Need help getting started?</p><p className="mt-1 text-sm text-muted-foreground">Browse setup guides or contact the EMASS team.</p></div>
            <Button variant="outline">Contact support</Button>
          </section>
          <footer className="flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between"><span>© 2026 Nanoveu · EMASS developer portal</span><span>All systems operational</span></footer>
        </main>
      </div>

      <Dialog open={Boolean(activeProduct)} onOpenChange={(open) => { if (!open) setActiveProduct(null) }}>
        {activeProduct && <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{activeProduct.name} <span className="text-sm font-normal text-muted-foreground">v{activeProduct.version}</span></DialogTitle><DialogDescription>{activeProduct.description}</DialogDescription></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="rounded-lg border bg-muted/30 p-4"><p className="text-sm font-medium">{activeProduct.file}</p><p className="mt-1 text-xs text-muted-foreground">{activeProduct.size} · Current stable release</p></div>
            <div><h3 className="mb-2 text-sm font-medium">Release notes</h3><ul className="space-y-2 text-sm text-muted-foreground">{activeProduct.notes.map((note) => <li key={note}><Check className="mr-2 inline size-4 text-emerald-600" />{note}</li>)}</ul></div>
            {[["SHA-256 checksum", activeProduct.checksum], ["Install command", activeProduct.command]].map(([label, value]) => <div key={label} className="flex min-w-0 items-center gap-2 rounded-md border p-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{label}</p><code className="mt-1 block truncate text-xs">{value}</code></div><Button size="icon" variant="ghost" aria-label={"Copy " + label} onClick={() => void copy(value, label)}><Copy /></Button></div>)}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setActiveProduct(null)}>Close</Button><Button onClick={() => { download(activeProduct.file); setActiveProduct(null) }}><ArrowDownToLine />Download package</Button></DialogFooter>
        </DialogContent>}
      </Dialog>
      <Toaster />
    </div>
  )
}

export default App
