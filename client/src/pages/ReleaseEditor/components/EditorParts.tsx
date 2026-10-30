import type { ReactNode } from "react"
import { Check, Circle, CircleAlert, Lock } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { VersionSuggestion } from "@/pages/Releases/releases.model"
import { cn } from "@/lib/utils"

/** A form card; `meta` sits next to the title (counts) and `actions` on the right. */
export function EditorCard({ title, description, meta, actions, children }: { title: string; description?: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">{title}{meta && <span className="text-xs font-normal text-muted-foreground">{meta}</span>}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export type CheckState = "ok" | "todo" | "error" | "optional"

export function CheckItem({ state, label }: { state: CheckState; label: string }) {
  const icon = state === "ok" ? <Check className="size-3.5 text-success" /> : state === "error" ? <CircleAlert className="size-3.5 text-destructive" /> : <Circle className="size-3.5 text-muted-foreground/60" />
  return <li className={cn("flex items-start gap-2 text-sm", state === "error" && "text-destructive", state === "optional" && "text-muted-foreground")}><span className="mt-0.5">{icon}</span>{label}</li>
}

type VersionFieldProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Shown instead of the hint when set (format or server error). */
  error: string | null
  suggestion: VersionSuggestion | null
  /** Read-only: the SDK files set this version, and only they can change it. */
  locked?: boolean
  /** Versions the SDK files mention when they don't agree, offered first. */
  candidates?: string[]
}

export function VersionField({ value, onChange, onBlur, error, suggestion, locked = false, candidates = [] }: VersionFieldProps) {
  const chips = [
    ...candidates.map((version) => ({ key: `file-${version}`, label: "In files", value: version })),
    ...(suggestion ? (["patch", "minor", "major"] as const).map((part) => ({ key: part, label: part, value: suggestion.suggestions[part] })) : []),
  ]
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="release-version" className="flex items-center gap-1.5 text-sm font-medium">Version{locked && <Lock aria-hidden className="size-3 text-muted-foreground" />}</label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-sm text-muted-foreground">v</span>
          <Input id="release-version" value={value} readOnly={locked} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={locked ? undefined : (suggestion?.suggestions.patch ?? "1.0.0")} inputMode="decimal" autoComplete="off" aria-invalid={Boolean(error) || undefined} aria-describedby="release-version-hint" className={cn("h-9 bg-card pl-6 font-mono", locked && "cursor-default bg-muted/40 text-foreground focus-visible:ring-0")} />
        </div>
      </div>
      <div id="release-version-hint" className="space-y-2 sm:col-span-2">
        {error
          ? <p className="text-xs text-destructive">{error}</p>
          : locked
            ? <p className="text-xs text-muted-foreground">Detected from your SDK files. Remove or replace them to change it.</p>
            : <p className="text-xs text-muted-foreground">{suggestion?.highestShipped ? <>Latest shipped <span className="font-mono">v{suggestion.highestShipped}</span></> : "Nothing shipped yet"}{candidates.length > 1 && " · Your SDK files mention different versions"}</p>}
        {!locked && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button key={chip.key} type="button" onClick={() => onChange(chip.value)} className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent", value.trim() === chip.value && "border-primary bg-primary/10 text-primary")}>
                <span className="text-muted-foreground capitalize">{chip.label}</span> <span className="font-mono">{chip.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
