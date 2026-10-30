// Same rule as the server's normalizeWebsite (server/src/schemas/auth.schema.ts)
export const WEBSITE_MAX = 255
export const WEBSITE_MESSAGE = "Enter a website like yourcompany.com"

/**
 * A website as people type it ("acme.com", "www.acme.com/en") as a full
 * http(s) URL: https:// is added when no scheme is given, and a bare domain
 * loses its trailing slash. Null when it isn't a public web address.
 */
export function normalizeWebsite(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  // A public host has a dot (no "localhost") and no credentials
  const host = url.hostname
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null
  if (url.username || url.password) return null
  const bare = url.pathname === "/" && !url.search && !url.hash
  const href = bare ? `${url.protocol}//${url.host}` : url.href
  return href.length <= WEBSITE_MAX ? href : null
}

/** "https://www.acme.com/en" → "acme.com/en": how a stored website is shown. */
export function displayWebsite(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")
}
