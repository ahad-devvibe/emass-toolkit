import { CheckCircle2, CircleAlert, FileText, Fingerprint, GitCompareArrows, Info, Package, TriangleAlert, type LucideIcon } from "lucide-react"
import { osMeta } from "@/pages/Catalog/catalog.meta"
import type { ReleaseDetail } from "@/pages/Releases/releases.model"
import { useRelease } from "@/pages/Releases/useReleaseQueries"
import { cn } from "@/lib/utils"
import { reviewCards, type CardTone, type LiveVersion, type ReviewCard } from "../review-cards"

const cardIcon: Record<ReviewCard["key"], LucideIcon> = { version: GitCompareArrows, checksums: Fingerprint, sdks: Package, docs: FileText }
const toneIcon: Record<CardTone, LucideIcon> = { ok: CheckCircle2, warn: TriangleAlert, bad: CircleAlert, neutral: Info }
// Same colors as the page's callouts, plus green for "all good"
const toneStyle: Record<CardTone, { accent: string; text: string }> = {
  ok: { accent: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  warn: { accent: "border-l-amber-500", text: "text-amber-700 dark:text-amber-400" },
  bad: { accent: "border-l-destructive", text: "text-destructive" },
  neutral: { accent: "border-l-border", text: "text-muted-foreground" },
}

/**
 * What an admin checks before publishing: the version step, checksums against
 * the live version, platform coverage, and docs plus release notes.
 */
export function ReviewCards({ release }: { release: ReleaseDetail }) {
  const current = release.review.currentPublished
  const previous = useRelease(current?.id)
  const live: LiveVersion = current ? { version: current.version, files: previous.data?.files ?? null, unavailable: Boolean(previous.error) } : null

  return (
    <section aria-label="Review checks" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {reviewCards(release, live).map((card) => {
        const Icon = cardIcon[card.key]
        const ToneIcon = toneIcon[card.tone]
        const style = toneStyle[card.tone]
        return (
          <div key={card.key} className={cn("rounded-xl border border-l-4 bg-card p-4", style.accent)}>
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon aria-hidden className="size-3.5" />{card.title}</p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-tight">
              {card.value}
              {card.platforms && card.platforms.length > 0 && (
                <span className="flex items-center gap-1.5 text-foreground/60">
                  {card.platforms.map((os) => { const { Icon: OsIcon, label } = osMeta[os]; return <OsIcon key={os} role="img" aria-label={label} title={label} className="size-3.5" /> })}
                </span>
              )}
            </p>
            <p className={cn("mt-1 flex items-start gap-1.5 text-xs", style.text)}><ToneIcon aria-hidden className="mt-px size-3.5 shrink-0" /><span>{card.detail}</span></p>
          </div>
        )
      })}
    </section>
  )
}
