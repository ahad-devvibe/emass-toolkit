import { EmailDomainKind, Prisma } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { classifyEmailDomain, type DomainClass } from "./domains.utils.js";

export async function loadDomainPolicySets(): Promise<{
  competitor: ReadonlySet<string>;
  freeMail: ReadonlySet<string>;
}> {
  const rows = await prisma.emailDomainPolicy.findMany({
    select: { domain: true, kind: true },
  });
  const competitor = new Set<string>();
  const freeMail = new Set<string>();
  for (const row of rows) {
    if (row.kind === EmailDomainKind.COMPETITOR) competitor.add(row.domain);
    else freeMail.add(row.domain);
  }
  return { competitor, freeMail };
}

export async function classifySignupEmail(email: string): Promise<DomainClass> {
  const { competitor, freeMail } = await loadDomainPolicySets();
  return classifyEmailDomain(email, competitor, freeMail);
}

const domainSelect = {
  id: true,
  domain: true,
  kind: true,
  createdAt: true,
} as const;

/** Every policy row, alphabetical. The list is small (tens of domains). */
export function listDomainPolicies() {
  return prisma.emailDomainPolicy.findMany({
    select: domainSelect,
    orderBy: { domain: "asc" },
  });
}

const listLabel = (kind: EmailDomainKind) =>
  kind === EmailDomainKind.COMPETITOR ? "competitor" : "free-mail";

/**
 * Adds a domain to one list. A domain is on at most one list, so adding it
 * again (to either) is a 409 naming the list that has it. Applies to new
 * sign-ups only.
 */
export async function addDomainPolicy(domain: string, kind: EmailDomainKind) {
  try {
    return await prisma.emailDomainPolicy.create({
      data: { domain, kind },
      select: domainSelect,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.emailDomainPolicy.findUnique({
        where: { domain },
        select: { kind: true },
      });
      throw new ApiError(
        409,
        existing
          ? `${domain} is already on the ${listLabel(existing.kind)} list`
          : `${domain} is already listed`,
        "DOMAIN_EXISTS",
        existing ? { kind: existing.kind } : undefined,
      );
    }
    throw err;
  }
}

export async function removeDomainPolicy(id: string): Promise<void> {
  const { count } = await prisma.emailDomainPolicy.deleteMany({
    where: { id },
  });
  if (count === 0) {
    throw ApiError.notFound("Domain not found", "DOMAIN_NOT_FOUND");
  }
}
