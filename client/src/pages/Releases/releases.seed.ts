// DEMO ONLY: in-memory release history until the releases API exists
import { products } from "@/pages/Catalog/catalog.data"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { parseSize } from "@/pages/ProductDetails/release.utils"
import type { Actor, ManagedRelease, StagedFile } from "./releases.types"

const dana: Actor = { name: "Dana Patel", role: "DEV" }
const alex: Actor = { name: "Alex Morgan", role: "ADMIN" }

const HOUR = 60 * 60 * 1000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

// Deterministic 64-hex stand-in so seeded rows look like real SHA-256 values
function fakeChecksum(seed: string): string {
  let out = ""
  let hash = 2166136261
  while (out.length < 64) {
    for (const char of seed + out.length) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
    out += hash.toString(16).padStart(8, "0")
  }
  return out.slice(0, 64)
}

function fromCatalogFile(file: ReleaseFile): StagedFile {
  const base = { name: file.name, sizeBytes: parseSize(file.size), checksum: file.checksum, autoDetected: true }
  return file.kind === "sdk" ? { ...base, kind: "sdk", os: file.os, arch: file.arch } : { ...base, kind: file.kind, title: file.title, format: file.format }
}

function staged(name: string, megabytes: number, mapping: Partial<StagedFile>): StagedFile {
  return { name, sizeBytes: Math.round(megabytes * 1024 * 1024), checksum: fakeChecksum(name), kind: null, autoDetected: true, ...mapping }
}

const catalogHistory: ManagedRelease[] = products.flatMap((product) =>
  product.releases.map((release, index) => {
    const at = new Date(release.released).toISOString()
    const events: ManagedRelease["events"] = [
      { type: "created", actor: dana, at },
      { type: "submitted", actor: dana, at },
      { type: "published", actor: alex, at },
    ]
    // Every release but the newest was superseded by the one above it
    if (index > 0) events.push({ type: "archived", actor: alex, at: new Date(product.releases[index - 1].released).toISOString(), note: `Superseded by v${product.releases[index - 1].version}` })
    return {
      id: `${product.id}-${release.version}`,
      productId: product.id,
      version: release.version,
      status: release.status === "Published" ? "published" : "archived",
      files: release.files.map(fromCatalogFile),
      releaseNotes: release.releaseNotes,
      createdBy: dana,
      updatedAt: events[events.length - 1].at,
      events,
    } satisfies ManagedRelease
  }),
)

const inProgress: ManagedRelease[] = [
  {
    id: "core-2.5.0",
    productId: "core",
    version: "2.5.0",
    status: "in_review",
    files: [
      staged("emass-core-sdk-2.5.0-win-x64.msi", 84, { kind: "sdk", os: "windows", arch: "x64" }),
      staged("emass-core-sdk-2.5.0-macos-universal.pkg", 63, { kind: "sdk", os: "macos", arch: "universal" }),
      staged("emass-core-sdk-2.5.0-linux-x64.tar.gz", 42, { kind: "sdk", os: "linux", arch: "x64" }),
      staged("emass-core-sdk-2.5.0-linux-arm64.tar.gz", 40, { kind: "sdk", os: "linux", arch: "arm64" }),
      staged("emass-core-sdk-2.5.0-api-reference.pdf", 4.4, { kind: "documentation", title: "API reference", format: "PDF" }),
    ],
    releaseNotes: "## Highlights\n\n- Hot-plug support for EMASS rev. D boards.\n- `emass-cli doctor` checks drivers, firmware and permissions in one go.\n\n## Fixes\n\n- Lower CPU use while devices are idle.\n",
    createdBy: dana,
    updatedAt: ago(5),
    events: [
      { type: "created", actor: dana, at: ago(30) },
      { type: "submitted", actor: dana, at: ago(5) },
    ],
  },
  {
    id: "core-2.4.1",
    productId: "core",
    version: "2.4.1",
    status: "changes_requested",
    files: [
      staged("emass-core-sdk-2.4.1-win-x64.msi", 82, { kind: "sdk", os: "windows", arch: "x64" }),
      staged("emass-core-sdk-2.4.1-macos-universal.pkg", 61, { kind: "sdk", os: "macos", arch: "universal" }),
    ],
    releaseNotes: "## Fixes\n\n- Patch for the USB reconnect regression in 2.4.0.\n",
    createdBy: dana,
    updatedAt: ago(20),
    events: [
      { type: "created", actor: dana, at: ago(52) },
      { type: "submitted", actor: dana, at: ago(48) },
      { type: "changes_requested", actor: alex, at: ago(20), note: "The macOS package isn't notarized, so Gatekeeper blocks it. Re-upload a notarized .pkg and add the Linux builds; customers on 2.4.0 Linux hit the same bug." },
    ],
  },
  {
    id: "vision-1.9.0",
    productId: "vision",
    version: "1.9.0",
    status: "draft",
    files: [
      staged("emass-vision-sdk-1.9.0-win-x64.zip", 96, { kind: "sdk", os: "windows", arch: "x64" }),
      staged("vision-calibration-profiles.bin", 12, { kind: null }),
    ],
    createdBy: dana,
    updatedAt: ago(2),
    events: [{ type: "created", actor: dana, at: ago(2) }],
  },
]

export const seedReleases: ManagedRelease[] = [...inProgress, ...catalogHistory]
