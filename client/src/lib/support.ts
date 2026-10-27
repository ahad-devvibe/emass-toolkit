/** The support address from VITE_SUPPORT_EMAIL, or null when it isn't configured. */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || null

/** A mailto: link to support, with an optional prefilled subject; null without an address. */
export function supportMailto(subject?: string, email: string | null = SUPPORT_EMAIL): string | null {
  if (!email) return null
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`
}
