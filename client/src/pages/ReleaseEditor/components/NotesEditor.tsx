import { lazy, Suspense, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

// Same lazy chunk the product page uses for release notes
const Markdown = lazy(() => import("@/components/common/Markdown").then((module) => ({ default: module.Markdown })))

const placeholder = "## Highlights\n\n- What's new in this version\n\n## Fixes\n\n- What was fixed"

export function NotesEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [tab, setTab] = useState("write")

  return (
    <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
      <TabsList>
        <TabsTrigger value="write" className="px-3">Write</TabsTrigger>
        <TabsTrigger value="preview" className="px-3">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <Textarea aria-label="Release notes (Markdown)" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-40 bg-card font-mono text-[13px]" />
        <p className="mt-1.5 text-xs text-muted-foreground">Markdown is supported: headings, lists, tables and code.</p>
      </TabsContent>
      <TabsContent value="preview" className="min-h-40 rounded-lg border bg-card px-4 py-3">
        {value.trim()
          ? <Suspense fallback={<div className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /></div>}><Markdown>{value}</Markdown></Suspense>
          : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
      </TabsContent>
    </Tabs>
  )
}
