import "dotenv/config";
import { UserStatus, type Prisma } from "@prisma/client";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { hashPassword } from "../../src/services/auth/auth.utils.js";

// Seeds (or deletes) a large batch of dummy free-mail signups waiting for
// approval, to exercise the admin Signups queue (paging, search, approve).
//   npm run bench:signups -- [--count 500] [--dry-run]   upsert
//   npm run bench:signups -- --delete [--dry-run]        delete them all
// Every row's email starts with emass-bench-, which is what --delete matches,
// so real users are never touched. Users are deterministic by index: a rerun
// updates the same rows and puts approved/rejected ones back to pending.

const EMAIL_PREFIX = "emass-bench-";
const PASSWORD = "Bench#12345";
const DEFAULT_COUNT = 500;
const MAX_COUNT = 50_000;
const BATCH_SIZE = 1_000;
const SPREAD_MS = 60 * 24 * 60 * 60 * 1000;

const DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
];
const FIRST_NAMES = [
  "Amelia", "Arjun", "Chen", "Daniel", "Elena", "Farah", "Hiro", "Isabel",
  "Jonas", "Kofi", "Lena", "Marco", "Nadia", "Omar", "Priya", "Sofia",
]; // prettier-ignore
const MIDDLE_NAMES = ["Rose", "James", "Lee", "Marie", "Ali"];
const LAST_NAMES = [
  "Andersen", "Banerjee", "Costa", "Dubois", "Evans", "Fischer", "Garcia",
  "Haddad", "Ito", "Kowalski", "Lim", "Mensah", "Nguyen", "Okafor", "Patel",
  "Rossi", "Silva", "Tan", "Wright", "Zhang",
]; // prettier-ignore
const COMPANIES = [
  "Freelance", "Northwind Labs", "Pixel Forge", "Bluefin Robotics",
  "Quantum Garage", "Self-employed", "Orbit Optics", "Lumen Devices",
]; // prettier-ignore
const JOB_TITLES = [
  "Firmware Engineer", "Embedded Developer", "Student", "CTO",
  "Hardware Hacker", "Product Engineer", "Researcher", "Consultant",
]; // prettier-ignore
const COUNTRIES = ["GB", "US", "SG", "DE", "IN", "AU", "JP", "FR", "BR", "CA"];

const pick = <T>(list: readonly T[], i: number) => list[i % list.length];

function benchEmail(i: number): string {
  return `${EMAIL_PREFIX}${String(i).padStart(5, "0")}@${pick(DOMAINS, i)}`;
}

/** User i, always the same; createdAt runs from 60 days ago (i = 1) to now. */
function benchUser(
  i: number,
  count: number,
  passwordHash: string,
  now: number,
): Prisma.UserCreateManyInput {
  return {
    email: benchEmail(i),
    firstName: pick(FIRST_NAMES, i),
    // Coprime list lengths spread the name combinations
    lastName: pick(LAST_NAMES, i * 7),
    middleName: i % 7 === 0 ? pick(MIDDLE_NAMES, i) : null,
    country: pick(COUNTRIES, i * 3),
    companyName: pick(COMPANIES, i * 5),
    jobTitle: pick(JOB_TITLES, i * 11),
    password: passwordHash,
    emailVerified: true,
    status: UserStatus.PENDING_APPROVAL,
    createdAt: new Date(now - SPREAD_MS * (1 - (i - 1) / Math.max(count, 1))),
  };
}

function fail(message: string): never {
  console.error(`bench-signups: ${message}`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const countAt = args.indexOf("--count");
  const count = countAt >= 0 ? Number(args[countAt + 1]) : DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    fail(`--count must be a whole number from 1 to ${MAX_COUNT}`);
  }
  return {
    remove: args.includes("--delete"),
    dryRun: args.includes("--dry-run"),
    count,
  };
}

function databaseName(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1) || "?";
  } catch {
    return "?";
  }
}

const benchRows = { email: { startsWith: EMAIL_PREFIX } };

async function deleteAll(dryRun: boolean): Promise<void> {
  const existing = await prisma.user.count({ where: benchRows });
  if (dryRun) {
    console.log(`  dry-run: would delete ${existing} bench users`);
    return;
  }
  const { count } = await prisma.user.deleteMany({ where: benchRows });
  console.log(`bench-signups: deleted ${count} bench users`);
}

async function upsert(count: number, dryRun: boolean): Promise<void> {
  const existing = await prisma.user.count({ where: benchRows });
  if (dryRun) {
    console.log(
      `  dry-run: would upsert ${count} bench users (${existing} bench users exist now)`,
    );
    return;
  }

  const passwordHash = await hashPassword(PASSWORD);
  const now = Date.now();
  let created = 0;
  let reset = 0;
  for (let start = 1; start <= count; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, count);
    const rows: Prisma.UserCreateManyInput[] = [];
    for (let i = start; i <= end; i++) {
      rows.push(benchUser(i, count, passwordHash, now));
    }
    created += (
      await prisma.user.createMany({ data: rows, skipDuplicates: true })
    ).count;
    // Existing rows an admin approved or rejected go back into the queue
    reset += (
      await prisma.user.updateMany({
        where: {
          email: { in: rows.map((row) => row.email) },
          status: { not: UserStatus.PENDING_APPROVAL },
        },
        data: { status: UserStatus.PENDING_APPROVAL, rejectionReason: null },
      })
    ).count;
    process.stdout.write(`\r  ${end}/${count}`);
  }
  process.stdout.write("\n");

  const pending = await prisma.user.count({
    where: { ...benchRows, status: UserStatus.PENDING_APPROVAL },
  });
  console.log(
    `bench-signups: created ${created}, reset to pending ${reset}, total pending bench users ${pending}`,
  );
  console.log(`  every bench user's password: ${PASSWORD}`);
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") fail("refusing to run in production");
  const { remove, dryRun, count } = parseArgs();

  console.log(
    `bench-signups: database "${databaseName()}", mode ${remove ? "delete" : `upsert ${count}`}`,
  );
  const live = [
    env.EMAIL_PROVIDER === "oci" && "EMAIL_PROVIDER=oci",
    env.HUBSPOT_ENABLED === "true" && "HUBSPOT_ENABLED=true",
  ].filter(Boolean);
  if (!remove && live.length > 0) {
    console.warn(
      `  warning: ${live.join(" and ")}. Approving bench users would email made-up addresses and create HubSpot contacts. Use console email and HubSpot off.`,
    );
  }

  if (remove) await deleteAll(dryRun);
  else await upsert(count, dryRun);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(
      `bench-signups: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
