import { ArrowDownToLine, Copy, FileArchive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"

export function ReleaseFileRow({ file, onDownload, onCopy }: { file: ReleaseFile; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }) {
  const shortChecksum = `${file.checksum.slice(0, 12)}…${file.checksum.slice(-8)}`
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-200 hover:border-primary/40 hover:bg-accent/40 sm:flex-row sm:items-center">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><FileArchive className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="break-all text-sm font-medium">{file.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{file.platform} · {file.size}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium">SHA-256</span>
          <Tooltip>
            <TooltipTrigger render={<code className="cursor-help rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80" />}>{shortChecksum}</TooltipTrigger>
            <TooltipContent className="max-w-sm break-all font-mono">{file.checksum}</TooltipContent>
          </Tooltip>
          <Button size="icon-xs" variant="ghost" aria-label={`Copy SHA-256 checksum for ${file.name}`} onClick={() => onCopy(file.checksum, "Checksum")}><Copy /></Button>
        </div>
      </div>
      <Button size="sm" onClick={() => onDownload(file)}><ArrowDownToLine className="transition-transform motion-safe:group-hover/button:translate-y-0.5" />Download</Button>
    </div>
  )
}
