import { formatVersion, parseVersion } from "../releases.utils.js";

/** "x.y.z" from its parts, or null for leading zeros, overflow or the 0.0.0 placeholder. */
function toVersion(major: string, minor: string, patch = "0"): string | null {
  const semver = parseVersion(`${major}.${minor}.${patch}`);
  if (
    !semver ||
    (semver.major === 0 && semver.minor === 0 && semver.patch === 0)
  ) {
    return null;
  }
  return formatVersion(semver);
}

// Matches, in a file name or a metadata text:
// - "1.2.0", "v1.2.0" or "1.2.0.4" (a fourth part is ignored);
// - "v1_2_0" / "v1-2-0" (other separators only after a v, so "x86_64" and
//   dates like "15-10-26" never read as versions);
// - "v1.4" / "Version 1.4" (two parts only after a v or the word "version").
// Commit hashes like "a08824c" never match: they carry no dots.
const TEXT_VERSION =
  /(?<![\d.])(?:v?(\d+)\.(\d+)\.(\d+)|v(\d+)([_-])(\d+)\5(\d+)|(?:(?<![a-z])v|version\s*)(\d+)\.(\d+)(?!\.?\d))(?!\d)/gi;

/** Every valid version a file name or text mentions, normalised to "1.2.0". */
export function versionsInText(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TEXT_VERSION)) {
    const version = match[1]
      ? toVersion(match[1], match[2], match[3])
      : match[4]
        ? toVersion(match[4], match[6], match[7])
        : toVersion(match[8], match[9]);
    if (version && !found.includes(version)) found.push(version);
  }
  return found;
}

// An optional v and Debian epoch ("1:"), two to four dotted parts, then the
// end or a suffix such as a Debian revision ("-1792088006") or a note.
const RAW_VERSION =
  /^v?(?:\d+:)?(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)?(?=$|[-+~_ (])/i;

/**
 * A version field's value as "x.y.z": "1.135.0.0", "1.135.0-1792088006",
 * "1:1.4.0-3", "v5.0" and "1, 2, 3, 0" all work. Null when it isn't one.
 */
export function normalizeVersion(raw: string): string | null {
  const match = RAW_VERSION.exec(raw.trim().replace(/\s*,\s*/g, "."));
  return match ? toVersion(match[1], match[2], match[3]) : null;
}
