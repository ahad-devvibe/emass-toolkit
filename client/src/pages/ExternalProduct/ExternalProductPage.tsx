import { useState, type ReactNode } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/common/AppShell"
import { PageLoader } from "@/components/common/PageLoader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { ProductCard } from "@/pages/Catalog/components/ProductCard"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { useResource } from "@/pages/Releases/useReleaseQueries"
import { externalProductApi, type ExternalProduct, type ExternalProductInput } from "./external-product.api"
import { cardProblems, formOf, isDirty, MAX_DESCRIPTION, MAX_LINK_LABEL, MAX_NAME, trimmed } from "./external-product.utils"

/** A labelled form field with an optional character count and its error under it. */
function FormField({ id, label, count, max, error, hint, children }: { id: string; label: string; count?: number; max?: number; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}
        {max !== undefined && <span className={cn("text-xs font-normal tabular-nums text-muted-foreground", count !== undefined && count > max && "text-destructive")}>{count}/{max}</span>}
      </label>
      {children}
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="border-b pb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** The editor for one external product: the form, and the catalog card as customers will see it. */
function ExternalProductEditor({ product, onSaved }: { product: ExternalProduct; onSaved: (product: ExternalProduct) => void }) {
  const [form, setForm] = useState<ExternalProductInput>(() => formOf(product))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const problems = cardProblems(form)
  const shown = attempted ? problems : {}
  const dirty = isDirty(product, form)
  const ids = { name: `name-${product.id}`, description: `description-${product.id}`, url: `url-${product.id}`, label: `label-${product.id}` }
  const set = (key: keyof ExternalProductInput) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const invalid = (key: keyof ExternalProductInput) => ({ "aria-invalid": Boolean(shown[key]) || undefined, "aria-describedby": shown[key] ? `${ids[key]}-error` : undefined })

  async function save() {
    setAttempted(true)
    setServerError(null)
    if (Object.keys(problems).length > 0) return
    setSaving(true)
    try {
      const saved = await externalProductApi.update(product.id, trimmed(form))
      onSaved(saved)
      setForm(formOf(saved))
      setAttempted(false)
      toast.success(`${saved.name} updated`)
    } catch (error) {
      setServerError(error instanceof ApiRequestError ? error.message : "Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setForm(formOf(product))
    setAttempted(false)
    setServerError(null)
  }

  // The card customers will see, from what's typed so far
  const preview = trimmed(form)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <form noValidate className="space-y-8 rounded-xl border bg-card p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <FormSection title="Card" description="The name and description on the catalog card.">
          <FormField id={ids.name} label="Name" count={form.name.trim().length} max={MAX_NAME} error={shown.name}>
            <Input id={ids.name} value={form.name} onChange={set("name")} {...invalid("name")} />
          </FormField>
          <FormField id={ids.description} label="Description" count={form.description.trim().length} max={MAX_DESCRIPTION} error={shown.description} hint="Optional. One or two sentences.">
            <Textarea id={ids.description} rows={3} value={form.description} onChange={set("description")} {...invalid("description")} />
          </FormField>
        </FormSection>

        <FormSection title="Button" description="Where the card's button takes customers, in a new tab.">
          <FormField id={ids.url} label="URL" error={shown.url} hint="A full https:// link.">
            <Input id={ids.url} type="url" inputMode="url" placeholder="https://" value={form.url} onChange={set("url")} {...invalid("url")} />
          </FormField>
          <FormField id={ids.label} label="Button label" count={form.label.trim().length} max={MAX_LINK_LABEL} error={shown.label}>
            <Input id={ids.label} value={form.label} onChange={set("label")} {...invalid("label")} />
          </FormField>
        </FormSection>

        {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p className="text-xs text-muted-foreground">Saved {relativeTime(product.updatedAt)}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={discard}>Discard</Button>
            <Button type="submit" disabled={!dirty || saving}>{saving && <Loader2 className="animate-spin" />}Save changes</Button>
          </div>
        </div>
      </form>

      <aside className="space-y-2 lg:sticky lg:top-20">
        <p className="text-xs font-medium text-muted-foreground">What customers see{!product.isActive && " (hidden from the catalog right now)"}</p>
        <ProductCard
          preview
          product={{
            id: product.id,
            name: preview.name || "Name",
            description: preview.description,
            imageUrl: null,
            link: { url: preview.url, label: preview.label || "Button label" },
            latest: null,
          }}
        />
        {dirty && <p className="text-xs text-muted-foreground">Unsaved changes: customers see these after you save.</p>}
      </aside>
    </div>
  )
}

/** Developers edit the catalog card of each product that only links elsewhere (today, one). */
export function ExternalProductPage() {
  const { data: products, error, reload, setData } = useResource("external-products", (signal) => externalProductApi.list(signal))

  return (
    <AppShell breadcrumb={["External Product"]}>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">External Product</h1>
          <p className="text-sm text-muted-foreground">A catalog card that sends customers to another site. It has no releases.</p>
        </header>
        {error ? (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            <p className="text-muted-foreground">{error.message}</p>
            <Button variant="outline" className="mt-4" onClick={reload}><RefreshCw />Try again</Button>
          </div>
        ) : !products ? (
          <PageLoader className="min-h-[40vh] bg-transparent" />
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground"><ExternalLink className="mx-auto mb-2 size-5" />There's no external product yet.</div>
        ) : (
          <div className="space-y-12">
            {products.map((product) => (
              <ExternalProductEditor key={product.id} product={product} onSaved={(saved) => setData(products.map((item) => (item.id === saved.id ? saved : item)))} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  )
}
