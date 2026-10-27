import type { EmailDomainKind } from "@prisma/client";

export type DomainClass = "COMPETITOR" | "FREE_MAIL" | "CUSTOM";

export function extractEmailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/**
 * Pure classification: blocked/allow lists are provided as Sets of
 * lowercase domains so the function stays free of IO (unit-testable).
 */
export function classifyEmailDomain(
  email: string,
  competitorDomains: ReadonlySet<string>,
  freeMailDomains: ReadonlySet<string>,
): DomainClass {
  const domain = extractEmailDomain(email);
  if (competitorDomains.has(domain)) return "COMPETITOR";
  if (freeMailDomains.has(domain)) return "FREE_MAIL";
  return "CUSTOM";
}

export function domainKindToClass(kind: EmailDomainKind): DomainClass {
  return kind;
}

/** A hostname with at least one dot and a letters-only TLD, lowercase. */
export const DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const MAX_DOMAIN_LENGTH = 253;

/**
 * What an admin typed into "add domain": trims, lowercases, and accepts
 * "@gmail.com" or a pasted address ("someone@gmail.com"). Null if what's
 * left isn't a domain.
 */
export function normalizeDomainInput(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const domain = value.includes("@")
    ? value.slice(value.lastIndexOf("@") + 1)
    : value;
  if (domain.length > MAX_DOMAIN_LENGTH || !DOMAIN_RE.test(domain)) return null;
  return domain;
}
