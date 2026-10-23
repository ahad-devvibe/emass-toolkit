import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fileKindMeta, osMeta } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { cn } from "@/lib/utils"

const kindItems = (Object.keys(fileKindMeta) as FileKind[]).map((kind) => ({ value: kind, label: fileKindMeta[kind].label }))
const osItems = (Object.keys(osMeta) as OperatingSystem[]).map((os) => ({ value: os, label: osMeta[os].label }))

function OptionSelect({ label, items, value, placeholder, invalid, disabled, onChange, className }: { label: string; items: { value: string; label: string }[]; value: string | null; placeholder: string; invalid?: boolean; disabled?: boolean; onChange: (value: string) => void; className?: string }) {
  return (
    <Select items={items} value={value} disabled={disabled} onValueChange={(next) => { if (next) onChange(String(next)) }}>
      <SelectTrigger aria-label={label} aria-invalid={invalid || undefined} size="sm" className={cn("bg-card", className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  )
}

type FileMappingSelectsProps = {
  name: string
  kind: FileKind | null
  os: OperatingSystem | null
  disabled?: boolean
  /** Docs never carry a platform; switching to SDK keeps any platform already picked. */
  onChange: (kind: FileKind, os: OperatingSystem | null) => void
}

/** Type, plus platform for SDKs (one build per platform, no architecture). */
export function FileMappingSelects({ name, kind, os, disabled, onChange }: FileMappingSelectsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <OptionSelect label={`Type for ${name}`} items={kindItems} value={kind} placeholder="Select type" invalid={!kind} disabled={disabled} onChange={(value) => onChange(value as FileKind, value === "sdk" ? os : null)} className="w-36" />
      {kind === "sdk" && <OptionSelect label={`Platform for ${name}`} items={osItems} value={os} placeholder="Select platform" invalid={!os} disabled={disabled} onChange={(value) => onChange("sdk", value as OperatingSystem)} className="w-36" />}
    </div>
  )
}
