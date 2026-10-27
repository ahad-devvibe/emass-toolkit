import type { ReactNode } from "react"
import { ArrowDownToLine, Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fileKindMeta, isSdkFile, osMeta } from "@/pages/Catalog/catalog.meta"
import type { OperatingSystem, ReleaseFile } from "@/pages/Catalog/catalog.types"
import { shortDate } from "../release.utils"

// How to check the download against our SHA-256 on each platform
const verifyCommands: Record<OperatingSystem, { label: string; command: (name: string) => string }> = {
  windows: { label: "Windows", command: (name) => `certutil -hashfile ${name} SHA256` },
  macos: { label: "macOS", command: (name) => `shasum -a 256 ${name}` },
  linux: { label: "Linux", command: (name) => `sha256sum ${name}` },
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>
}

function CopyBlock({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string, label: string) => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 py-2 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs leading-5 break-all">{value}</code>
      <Button size="icon-sm" variant="ghost" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => onCopy(value, label)}><Copy /></Button>
    </div>
  )
}

// Staff previews have no release date yet
export type FileVersion = { version: string; released?: string }

type FileDetailsDialogProps = { file: ReleaseFile | null; version: FileVersion; downloading?: boolean; onOpenChange: (open: boolean) => void; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }

/** Everything about one file, including the SHA-256 the main list leaves out. */
export function FileDetailsDialog({ file, version, downloading, onOpenChange, onDownload, onCopy }: FileDetailsDialogProps) {
  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {file && <FileDetails file={file} version={version} downloading={downloading} onDownload={onDownload} onCopy={onCopy} />}
      </DialogContent>
    </Dialog>
  )
}

function FileDetails({ file, version, downloading, onDownload, onCopy }: { file: ReleaseFile; version: FileVersion; downloading?: boolean; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }) {
  const sdk = isSdkFile(file)
  const Icon = sdk ? osMeta[file.os].Icon : fileKindMeta[file.kind].Icon
  const title = sdk ? `${osMeta[file.os].label} SDK` : file.title
  // SDK builds have one platform; documents can be checked anywhere
  const commands = sdk ? [verifyCommands[file.os]] : [verifyCommands.macos, verifyCommands.linux, verifyCommands.windows]

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#0d72b9]/10 text-[#0d72b9] dark:bg-white/10 dark:text-[#7cc6f8]"><Icon aria-hidden className="size-[18px]" /></span>
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{file.name}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <dl className="divide-y text-sm">
        <Detail label="Type">{fileKindMeta[file.kind].label}</Detail>
        {sdk ? <Detail label="Platform">{osMeta[file.os].label}</Detail> : <Detail label="Format">{file.format}</Detail>}
        <Detail label="Size">{file.size}</Detail>
        <Detail label="Version"><span className="font-mono">v{version.version}</span></Detail>
        {version.released && <Detail label="Released">{shortDate(version.released)}</Detail>}
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">SHA-256 checksum</h3>
        <CopyBlock label="Checksum" value={file.checksum} onCopy={onCopy} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Verify after download</h3>
        <p className="text-xs text-muted-foreground">Run this where the file was saved; the output must match the checksum above.</p>
        {commands.map(({ label, command }) => (
          <div key={label} className="space-y-1">
            {commands.length > 1 && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
            <CopyBlock label="Command" value={command(file.name)} onCopy={onCopy} />
          </div>
        ))}
      </section>

      <DialogFooter showCloseButton>
        <Button disabled={downloading} onClick={() => onDownload(file)}>{downloading ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}Download</Button>
      </DialogFooter>
    </>
  )
}
