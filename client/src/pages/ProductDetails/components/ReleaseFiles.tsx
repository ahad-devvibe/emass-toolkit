import { useState } from "react"
import { fileKindMeta, isSdkFile } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem, ReleaseFile } from "@/pages/Catalog/catalog.types"
import { FileDetailsDialog, type FileVersion } from "./FileDetailsDialog"
import { FileRow } from "./FileRow"
import { Section } from "./Section"

type ReleaseFilesProps = { files: ReleaseFile[]; version: FileVersion; recommendedOs: OperatingSystem | null; /** The file whose link is being made, if any */ downloadingId?: string | null; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }

export function ReleaseFiles({ files: allFiles, version, recommendedOs, downloadingId, onDownload, onCopy }: ReleaseFilesProps) {
  const [detailsFile, setDetailsFile] = useState<ReleaseFile | null>(null)
  const isRecommended = (file: ReleaseFile) => isSdkFile(file) && file.os === recommendedOs
  // The visitor's OS floats to the top of the SDK group; sort is stable so data order holds otherwise
  const groups = (Object.keys(fileKindMeta) as FileKind[])
    .map((kind) => ({ kind, files: allFiles.filter((file) => file.kind === kind).sort((a, b) => Number(isRecommended(b)) - Number(isRecommended(a))) }))
    .filter((group) => group.files.length > 0)

  return (
    <>
      {groups.map(({ kind, files }) => (
        <Section key={kind} id={`files-${kind}`} title={fileKindMeta[kind].label} count={files.length}>
          <ul className="divide-y">{files.map((file) => <FileRow key={file.name} file={file} recommended={isRecommended(file)} downloading={downloadingId === file.id} onDownload={onDownload} onDetails={setDetailsFile} />)}</ul>
        </Section>
      ))}
      <FileDetailsDialog file={detailsFile} version={version} downloading={!!detailsFile && downloadingId === detailsFile.id} onOpenChange={(open) => { if (!open) setDetailsFile(null) }} onDownload={onDownload} onCopy={onCopy} />
    </>
  )
}
