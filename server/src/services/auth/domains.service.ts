import { EmailDomainKind } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
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
