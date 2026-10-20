import { FileQuestion, Loader2, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fileKindMeta, osMeta } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import type { StagedFile } from "@/pages/Releases/releases.types"
import { cn } from "@/lib/utils"
import { formatFromName, titleFromName } from "../detect-file"
import { isMapped, isUploaded, PENDING_HASH, type EditorFile } from "../editor.utils"

const kindItems = (Object.keys(fileKindMeta) as FileKind[]).map((kind) => ({ value: kind, label: kind === "manual" ? "Manual" : fileKindMeta[kind].label }))
const osItems = (Object.keys(osMeta) as OperatingSystem[]).map((os) => ({ value: os, label: osMeta[os].label }))
const archItems = ["x64", "arm64", "universal"].map((arch) => ({ value: arch, label: arch }))

function OptionSelect({ label, items, value, placeholder, invalid, onChange, className }: { label: string; items: { value: string; label: string }[]; value: string | null; placeholder: string; invalid?: boolean; onChange: (value: string) => void; className?: string }) {
  return (
    <Select items={items} value={value} onValueChange={(next) => { if (next) onChange(String(next)) }}>
      <SelectTrigger aria-label={label} aria-invalid={invalid || undefined} size="sm" className={cn("bg-card", className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function FileIcon({ file }: { file: StagedFile }) {
  if (file.kind === "sdk" && file.os) { const { Icon } = osMeta[file.os]; return <Icon aria-hidden className="size-4" /> }
  if (file.kind) { const { Icon } = fileKindMeta[file.kind]; return <Icon aria-hidden className="size-4" /> }
  return <FileQuestion aria-hidden className="size-4" />
}

type UploadRowProps = { file: EditorFile; duplicate: boolean; onChange: (patch: Partial<StagedFile>) => void; onRemove: () => void }

export function UploadRow({ file, duplicate, onChange, onRemove }: UploadRowProps) {
  const uploading = file.progress < 100
  const mapped = isMapped(file)

  function changeKind(kind: FileKind) {
    if (kind === "sdk") onChange({ kind, title: undefined, format: undefined })
    else onChange({ kind, os: undefined, arch: undefined, title: file.title || titleFromName(file.name), format: file.format || formatFromName(file.name) })
  }

  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70", !file.kind && "bg-amber-500/10 text-amber-600 dark:text-amber-400")}><FileIcon file={file} /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium" title={file.name}>{file.name}</span>
            {duplicate
              ? <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-px text-[11px] font-medium text-destructive">Duplicate name</span>
              : !mapped
                ? <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300">Needs mapping</span>
                : file.autoDetected
                  ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-px text-[11px] font-medium text-primary"><Sparkles className="size-3" />Auto-detected</span>
                  : <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">Edited</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{formatBytes(file.sizeBytes)}</span>
            <span aria-hidden>·</span>
            {uploading
              ? <span className="tabular-nums">Uploading {Math.floor(file.progress)}%</span>
              : file.checksum === PENDING_HASH
                ? <span>Checksum computed on upload</span>
                : isUploaded(file)
                ? <span className="font-mono" title={file.checksum}>sha256:{file.checksum.slice(0, 10)}</span>
                : <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />Computing checksum</span>}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={onRemove}><X /></Button>
      </div>

      {uploading && (
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Uploading ${file.name}`} aria-valuenow={Math.floor(file.progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${file.progress}%` }} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 sm:pl-12">
        <OptionSelect label={`Type for ${file.name}`} items={kindItems} value={file.kind} placeholder="Select type" invalid={!file.kind} onChange={(value) => changeKind(value as FileKind)} className="w-36" />
        {file.kind === "sdk" && (
          <>
            <OptionSelect label={`Platform for ${file.name}`} items={osItems} value={file.os ?? null} placeholder="Select OS" invalid={!file.os} onChange={(value) => onChange({ os: value as OperatingSystem })} className="w-32" />
            <OptionSelect label={`Architecture for ${file.name}`} items={archItems} value={file.arch ?? null} placeholder="Arch" invalid={!file.arch} onChange={(value) => onChange({ arch: value })} className="w-28" />
          </>
        )}
        {(file.kind === "documentation" || file.kind === "manual") && (
          <Input aria-label={`Title for ${file.name}`} aria-invalid={!file.title?.trim() || undefined} value={file.title ?? ""} onChange={(event) => onChange({ title: event.target.value })} placeholder="Title shown to customers" className="h-7 min-w-40 flex-1 bg-card" />
        )}
      </div>
    </li>
  )
}
