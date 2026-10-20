import { ArrowDownToLine, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fileKindMeta, isSdkFile, osMeta } from "@/pages/Catalog/catalog.meta"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"

function FileIcon({ file }: { file: ReleaseFile }) {
  if (isSdkFile(file)) { const { Icon } = osMeta[file.os]; return <Icon aria-hidden className="size-[18px]" /> }
  const { Icon } = fileKindMeta[file.kind]
  return <Icon aria-hidden className="size-[18px]" />
}

export function FileRow({ file, recommended, onDownload, onCopy }: { file: ReleaseFile; recommended: boolean; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }) {
  const title = isSdkFile(file) ? osMeta[file.os].label : file.title
  const detail = isSdkFile(file) ? file.arch : file.format

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70"><FileIcon file={file} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium" title={file.name}>{title}</span>
          <span className="text-muted-foreground">{detail}</span>
          {recommended && <span className="rounded-full bg-primary/10 px-2 py-px text-[11px] font-medium text-primary">Your OS</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{file.size}</span>
          <span aria-hidden>·</span>
          <Tooltip>
            <TooltipTrigger render={<button type="button" aria-label={`Copy SHA-256 checksum for ${file.name}`} onClick={() => onCopy(file.checksum, "Checksum")} className="inline-flex items-center gap-1 rounded font-mono outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />}>
              sha256:{file.checksum.slice(0, 10)}<Copy className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-all font-mono">{file.checksum}</TooltipContent>
          </Tooltip>
        </p>
      </div>
      <Button size="sm" variant={recommended ? "default" : "outline"} aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}><ArrowDownToLine /><span className="hidden sm:inline">Download</span></Button>
    </li>
  )
}
