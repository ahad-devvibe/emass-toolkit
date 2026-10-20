import { fileKindMeta, isSdkFile } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem, ReleaseFile } from "@/pages/Catalog/catalog.types"
import { FileRow } from "./FileRow"
import { Section } from "./Section"

export function ReleaseFiles({ files, recommendedOs, onDownload, onCopy }: { files: ReleaseFile[]; recommendedOs: OperatingSystem | null; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }) {
  const isRecommended = (file: ReleaseFile) => isSdkFile(file) && file.os === recommendedOs
  // The visitor's OS floats to the top of the SDK group; sort is stable so data order holds otherwise
  const groups = (Object.keys(fileKindMeta) as FileKind[])
    .map((kind) => ({ kind, files: files.filter((file) => file.kind === kind).sort((a, b) => Number(isRecommended(b)) - Number(isRecommended(a))) }))
    .filter((group) => group.files.length > 0)

  return groups.map(({ kind, files: groupFiles }) => (
    <Section key={kind} id={`files-${kind}`} title={fileKindMeta[kind].label} count={groupFiles.length}>
      <ul className="divide-y">{groupFiles.map((file) => <FileRow key={file.name} file={file} recommended={isRecommended(file)} onDownload={onDownload} onCopy={onCopy} />)}</ul>
    </Section>
  ))
}
