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
