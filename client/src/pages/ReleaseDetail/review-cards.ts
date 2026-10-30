import { osMeta } from "@/pages/Catalog/catalog.meta"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { ReleaseDetail, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { parseSemver, versionLabel } from "@/pages/Releases/version.utils"

// What an admin checks before publishing, as 4 cards. Pure: the page passes
// the release under review and the live version it would replace.

export type CardTone = "ok" | "warn" | "bad" | "neutral"

export type ReviewCard = {
  key: "version" | "checksums" | "sdks" | "docs"
  title: string
  value: string
  detail: string
  tone: CardTone
  /** SDK card: the platforms present, in display order. */
  platforms?: OperatingSystem[]
}

/** The live version and its files: null for a first release; files null while loading; unavailable if it couldn't be loaded. */
export type LiveVersion = { version: string; files: Pick<ReleaseFileItem, "sha256">[] | null; unavailable?: boolean } | null

const PLATFORMS = Object.keys(osMeta) as OperatingSystem[]
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const hasIssue = (file: ReleaseFileItem, codes: string[]) => [...file.blockedBy, ...file.warnings].some((issue) => codes.includes(issue.code))

export function bumpKind(from: string, to: string): "major" | "minor" | "patch" | null {
  const a = parseSemver(from)
  const b = parseSemver(to)
  if (!a || !b) return null
  if (b.major !== a.major) return "major"
  if (b.minor !== a.minor) return "minor"
  return b.patch !== a.patch ? "patch" : null
}

function versionCard(release: ReleaseDetail): ReviewCard {
  const previous = release.review.currentPublished?.version
  const bump = previous && release.version ? bumpKind(previous, release.version) : null
  const value = previous ? `v${previous} → ${versionLabel(release.version)}` : `${versionLabel(release.version)}`
  const title = previous ? `Version${bump ? ` · ${bump}` : ""}` : "Version · first release"
  const wrong = release.files.filter((file) => hasIssue(file, ["VERSION_MISMATCH", "VERSION_EXISTS"]))
  if (wrong.length) return { key: "version", title, value, tone: "bad", detail: `${plural(wrong.length, "installer")} ${wrong.length === 1 ? "says" : "say"} another version` }
  const silent = release.files.filter((file) => hasIssue(file, ["DOC_VERSION_MISMATCH", "NO_VERSION"]))
  if (silent.length) return { key: "version", title, value, tone: "warn", detail: `${plural(silent.length, "file")} ${silent.length === 1 ? "doesn't" : "don't"} mention ${versionLabel(release.version)}` }
  return { key: "version", title, value, tone: "ok", detail: `All files match ${versionLabel(release.version)}` }
}

function checksumCard(release: ReleaseDetail, live: LiveVersion): ReviewCard {
  const base = { key: "checksums" as const, title: "Checksums" }
  const unhashed = release.files.filter((file) => !file.sha256).length
  const value = unhashed ? `${plural(unhashed, "file")} without SHA-256` : "SHA-256 verified"
  if (unhashed) return { ...base, value, tone: "bad", detail: "Every file needs a checksum" }
  // Upload blocks these; shown in case one slipped in before the rule existed
  const repeated = release.files.filter((file) => hasIssue(file, ["SAME_CONTENT"]))
  if (repeated.length) return { ...base, value, tone: "bad", detail: `${plural(repeated.length, "installer")} ${repeated.length === 1 ? "repeats" : "repeat"} an earlier build` }
  if (!live) return { ...base, value, tone: "neutral", detail: "First release · nothing earlier to compare" }
  if (live.unavailable) return { ...base, value, tone: "neutral", detail: `Couldn't load v${live.version} to compare` }
  if (!live.files) return { ...base, value, tone: "neutral", detail: `Comparing with v${live.version}…` }
  const earlier = new Set(live.files.map((file) => file.sha256))
  const unchanged = release.files.filter((file) => earlier.has(file.sha256))
  if (unchanged.length === 1) return { ...base, value, tone: "warn", detail: `${unchanged[0].name} is unchanged from v${live.version}` }
  if (unchanged.length > 1) return { ...base, value, tone: "warn", detail: `${plural(unchanged.length, "file")} unchanged from v${live.version}` }
  return { ...base, value, tone: "ok", detail: `All files new since v${live.version}` }
}

function sdkCard(release: ReleaseDetail): ReviewCard {
  const present = new Set(release.files.filter((file) => file.kind === "sdk" && file.os).map((file) => file.os!))
  const platforms = PLATFORMS.filter((os) => present.has(os))
  const missing = PLATFORMS.filter((os) => !present.has(os)).map((os) => osMeta[os].label)
  const tone: CardTone = platforms.length === PLATFORMS.length ? "ok" : platforms.length === PLATFORMS.length - 1 ? "warn" : "bad"
  return {
    key: "sdks",
    title: "Core SDKs",
    value: `${platforms.length} / ${PLATFORMS.length} platforms`,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "Windows, macOS and Ubuntu",
    tone,
    platforms,
  }
}

function docsCard(release: ReleaseDetail): ReviewCard {
  const docs = release.files.filter((file) => file.kind === "documentation").length
  const notes = release.releaseNotes.trim().length > 0
  const missing = Number(docs === 0) + Number(!notes)
  return {
    key: "docs",
    title: "Docs & release notes",
    value: [docs ? plural(docs, "doc") : "No docs", notes ? "notes written" : "no notes"].join(" · "),
    detail: missing === 0 ? "Guides and release notes are in" : missing === 2 ? "Add a doc and write the release notes" : docs ? "Release notes aren't written" : "No documentation attached",
    tone: missing === 0 ? "ok" : missing === 1 ? "warn" : "bad",
  }
}

export function reviewCards(release: ReleaseDetail, live: LiveVersion): ReviewCard[] {
  return [versionCard(release), checksumCard(release, live), sdkCard(release), docsCard(release)]
}
