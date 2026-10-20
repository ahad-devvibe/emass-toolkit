import { BookOpen, FileText, Package, type LucideIcon } from "lucide-react"
import type { IconType } from "react-icons"
import { FaApple, FaLinux, FaWindows } from "react-icons/fa6"
import type { FileKind, OperatingSystem, ReleaseFile, SdkFile } from "./catalog.types"

export const osMeta: Record<OperatingSystem, { label: string; Icon: IconType }> = {
  windows: { label: "Windows", Icon: FaWindows },
  macos: { label: "macOS", Icon: FaApple },
  linux: { label: "Linux", Icon: FaLinux },
}

// Order here is the order groups render on the product page
export const fileKindMeta: Record<FileKind, { label: string; Icon: LucideIcon }> = {
  sdk: { label: "SDK", Icon: Package },
  documentation: { label: "Documentation", Icon: FileText },
  manual: { label: "Manuals", Icon: BookOpen },
}

export function isSdkFile(file: ReleaseFile): file is SdkFile {
  return file.kind === "sdk"
}

// Unique operating systems across a release's SDK files, in osMeta order
export function supportedOs(files: ReleaseFile[]): OperatingSystem[] {
  const present = new Set(files.filter(isSdkFile).map((file) => file.os))
  return (Object.keys(osMeta) as OperatingSystem[]).filter((os) => present.has(os))
}
