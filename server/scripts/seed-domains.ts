import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EmailDomainKind } from "@prisma/client";
import { prisma } from "../src/configs/prisma.js";
import { logger } from "../src/configs/logger.js";
import { DOMAIN_RE } from "../src/services/auth/domains.utils.js";

const POLICY_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "domain-policy.json",
);

const policyFileSchema = z.object({
  freeMail: z.array(z.string()).default([]),
  competitor: z.array(z.string()).default([]),
});

interface NormalizedPolicy {
  freeMail: string[];
  competitor: string[];
}

function normalizeDomain(raw: string, list: string): string {
  const domain = raw.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`${list}: "${raw}" is not a valid domain`);
  }
  return domain;
}

function fail(message: string): never {
  console.error(`domain-policy: ${message}`);
  process.exit(1);
}

function loadPolicyFile(): NormalizedPolicy {
  let raw: string;
  try {
    raw = readFileSync(POLICY_FILE, "utf8");
  } catch {
    fail(`cannot read ${POLICY_FILE}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in data/domain-policy.json (${String(err)})`);
  }

  const result = policyFileSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      console.error(`domain-policy: ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const freeMail = result.data.freeMail.map((d) =>
    normalizeDomain(d, "freeMail"),
  );
  const competitor = result.data.competitor.map((d) =>
    normalizeDomain(d, "competitor"),
  );

  for (const [list, domains] of [
    ["freeMail", freeMail],
    ["competitor", competitor],
  ] as const) {
    const seen = new Set<string>();
    for (const domain of domains) {
      if (seen.has(domain)) fail(`${list}: duplicate entry "${domain}"`);
      seen.add(domain);
    }
  }

  const freeMailSet = new Set(freeMail);
  for (const domain of competitor) {
    if (freeMailSet.has(domain)) {
      fail(`"${domain}" appears in both freeMail and competitor lists`);
    }
  }

  return { freeMail, competitor };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const policy = loadPolicyFile();

  const desired = [
    ...policy.competitor.map((domain) => ({
      domain,
      kind: EmailDomainKind.COMPETITOR,
    })),
    ...policy.freeMail.map((domain) => ({
      domain,
      kind: EmailDomainKind.FREE_MAIL,
    })),
  ];

  const existing = await prisma.emailDomainPolicy.findMany({
    select: { domain: true },
  });
  const existingSet = new Set(existing.map((row) => row.domain));

  const toCreate = desired.filter((row) => !existingSet.has(row.domain));
  const unchanged = desired.length - toCreate.length;
  const desiredSet = new Set(desired.map((row) => row.domain));
  const dbOnly = [...existingSet].filter((domain) => !desiredSet.has(domain));

  console.log(`domain-policy: ${POLICY_FILE}`);
  console.log(
    `  plan: create ${toCreate.length}, unchanged ${unchanged}, db-only ${dbOnly.length}`,
  );
  for (const row of toCreate) {
    console.log(`  + ${row.domain} (${row.kind})`);
  }
  for (const domain of dbOnly) {
    console.warn(
      `  ! ${domain} exists in DB but not in the file — left untouched (never auto-deleted)`,
    );
  }

  if (dryRun) {
    console.log("  dry-run: no changes written");
    return;
  }

  if (toCreate.length > 0) {
    const { count } = await prisma.emailDomainPolicy.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    console.log(`domain-policy: created ${count} rows`);
  } else {
    console.log("domain-policy: nothing to create");
  }
  logger.info(
    { created: toCreate.length, unchanged, dbOnly },
    "domain policy synced",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "domain policy seeding failed");
    process.exit(1);
  });
