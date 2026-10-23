export type Semver = { major: number; minor: number; patch: number }

// Same rule as the server: MAJOR.MINOR.PATCH, no prefix, no leading zeros
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}
