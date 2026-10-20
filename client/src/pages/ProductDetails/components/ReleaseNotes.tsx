import { lazy, Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Section } from "./Section"

// The markdown parser is ~47 kB gzipped; load it only when notes are first opened
const Markdown = lazy(() => import("@/components/common/Markdown").then((module) => ({ default: module.Markdown })))

export function ReleaseNotes({ notes, open, onOpenChange }: { notes: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Section id="release-notes" title="Release notes" open={open} onOpenChange={onOpenChange}>
      <div className="px-5 py-4">
        {open && <Suspense fallback={<div className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>}><Markdown>{notes}</Markdown></Suspense>}
      </div>
    </Section>
  )
}
