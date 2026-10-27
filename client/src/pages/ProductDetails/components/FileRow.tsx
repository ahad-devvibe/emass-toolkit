import { ArrowDownToLine, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fileKindMeta, isSdkFile, osMeta } from "@/pages/Catalog/catalog.meta"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { formatFromName } from "@/pages/ReleaseEditor/detect-file"

function FileIcon({ file }: { file: ReleaseFile }) {
  if (isSdkFile(file)) { const { Icon } = osMeta[file.os]; return <Icon aria-hidden className="size-[18px]" /> }
  const { Icon } = fileKindMeta[file.kind]
  return <Icon aria-hidden className="size-[18px]" />
}

// The checksum lives in the details dialog; the row stays scannable
export function FileRow({ file, recommended, downloading, onDownload, onDetails }: { file: ReleaseFile; recommended: boolean; downloading?: boolean; onDownload: (file: ReleaseFile) => void; onDetails: (file: ReleaseFile) => void }) {
  const title = isSdkFile(file) ? osMeta[file.os].label : file.title
  const detail = isSdkFile(file) ? formatFromName(file.name) : file.format

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70"><FileIcon file={file} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium" title={file.name}>{title}</span>
          <span className="text-muted-foreground">{detail}</span>
          {recommended && <span className="rounded-full bg-primary/10 px-2 py-px text-[11px] font-medium text-primary">Your OS</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{file.size}</p>
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Details for ${file.name}`} onClick={() => onDetails(file)} />}><Info /></TooltipTrigger>
        <TooltipContent>File details & checksum</TooltipContent>
      </Tooltip>
      <Button size="sm" variant={recommended ? "default" : "outline"} aria-label={`Download ${file.name}`} disabled={downloading} onClick={() => onDownload(file)}>{downloading ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}<span className="hidden sm:inline">Download</span></Button>
    </li>
  )
}
