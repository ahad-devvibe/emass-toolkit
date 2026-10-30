export type Semver = { major: number; minor: number; patch: number }

// Same rule as the server: MAJOR.MINOR.PATCH, no prefix, no leading zeros
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

/** "v1.2.3", or "No version yet" for a draft that has none. */
export const versionLabel = (version: string | null) => (version ? `v${version}` : "No version yet")

/** "EMASS SDK v1.2.3", or "EMASS SDK (no version yet)". */
export const releaseTitle = (release: { product: { name: string }; version: string | null }) =>
  release.version ? `${release.product.name} v${release.version}` : `${release.product.name} (no version yet)`

/** "x.y.z" from its parts, or null for leading zeros or the 0.0.0 placeholder. */
function toVersion(major: string, minor: string, patch = "0"): string | null {
  const version = `${Number(major)}.${Number(minor)}.${Number(patch)}`
  if (version === "0.0.0" || [major, minor, patch].some((part) => part.length > 1 && part.startsWith("0"))) return null
  return parseSemver(version) ? version : null
}

// The server's rule (file-inspect/versions.ts): "1.2.0", "v1.2.0" or "1.2.0.4";
// "v1_2_0" / "v1-2-0" (other separators only after a v, so "x86_64" and dates
// never read as versions); "v1.4" / "version 1.4" (two parts only after a v)
const NAME_VERSION = /(?<![\d.])(?:v?(\d+)\.(\d+)\.(\d+)|v(\d+)([_-])(\d+)\5(\d+)|(?:(?<![a-z])v|version\s*)(\d+)\.(\d+)(?!\.?\d))(?!\d)/gi

/** Every version a file name mentions, as "1.2.0", in order and once each. */
export function versionsInName(name: string): string[] {
  const found: string[] = []
  for (const match of name.matchAll(NAME_VERSION)) {
    const version = match[1] ? toVersion(match[1], match[2], match[3]) : match[4] ? toVersion(match[4], match[6], match[7]) : toVersion(match[8], match[9])
    if (version && !found.includes(version)) found.push(version)
  }
  return found
}
