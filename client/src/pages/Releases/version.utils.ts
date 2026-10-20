export type Semver = { major: number; minor: number; patch: number }

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

// Unparseable versions sort first so they never count as "latest"
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return Number(Boolean(left)) - Number(Boolean(right))
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

export function bump(version: string, part: keyof Semver): string | null {
  const parsed = parseSemver(version)
  if (!parsed) return null
  if (part === "major") return `${parsed.major + 1}.0.0`
  if (part === "minor") return `${parsed.major}.${parsed.minor + 1}.0`
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}
