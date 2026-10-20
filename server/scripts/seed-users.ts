import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../src/configs/prisma.js";
import { isCountryCode } from "../src/utils/country.utils.js";
import { logger } from "../src/configs/logger.js";
import {
  hashPassword,
  normalizeEmail,
} from "../src/services/auth/auth.utils.js";

// Local, gitignored list of accounts to seed. Copy staff-users.example.json
// and append an object per user. Usage:
//   npm run seed:users [-- --dry-run] [-- --reset-passwords]
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const USERS_FILE = join(DATA_DIR, "staff-users.json");

const userEntrySchema = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80),
  companyName: z.string().trim().min(1).max(120),
  jobTitle: z.string().trim().min(1).max(120),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter ISO country code")
    .refine(isCountryCode, "must be an assigned ISO 3166-1 alpha-2 code")
    .transform((c) => c.toUpperCase()),
  role: z.enum(UserRole).default(UserRole.CUSTOMER),
  password: z.string().min(6).max(72),
});

const usersFileSchema = z.object({ users: z.array(userEntrySchema) });

type UserEntry = z.infer<typeof userEntrySchema>;

function fail(message: string): never {
  console.error(`seed-users: ${message}`);
  process.exit(1);
}

function loadUsersFile(): UserEntry[] {
  if (!existsSync(USERS_FILE)) {
    fail(
      `${USERS_FILE} not found — copy data/staff-users.example.json to data/staff-users.json and edit it`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(USERS_FILE, "utf8"));
  } catch (err) {
    fail(`invalid JSON in data/staff-users.json (${String(err)})`);
  }

  const result = usersFileSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      console.error(`seed-users: ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const users = result.data.users.map((u) => ({
    ...u,
    email: normalizeEmail(u.email),
  }));
  const seen = new Set<string>();
  for (const user of users) {
    if (seen.has(user.email)) fail(`duplicate entry "${user.email}"`);
    seen.add(user.email);
  }
  return users;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resetPasswords = process.argv.includes("--reset-passwords");
  const users = loadUsersFile();

  const existing = await prisma.user.findMany({
    where: { email: { in: users.map((u) => u.email) } },
    select: { email: true },
  });
  const existingSet = new Set(existing.map((row) => row.email));
  const toCreate = users.filter((u) => !existingSet.has(u.email));
  const toUpdate = users.filter((u) => existingSet.has(u.email));

  console.log(`seed-users: ${USERS_FILE}`);
  console.log(
    `  plan: create ${toCreate.length}, update ${toUpdate.length}${resetPasswords ? " (passwords reset)" : ""}`,
  );
  for (const u of toCreate) console.log(`  + ${u.email} (${u.role})`);
  for (const u of toUpdate) console.log(`  ~ ${u.email} (${u.role})`);

  if (dryRun) {
    console.log("  dry-run: no changes written");
    return;
  }

  for (const { password, ...profile } of users) {
    const isNew = !existingSet.has(profile.email);
    const passwordHash =
      isNew || resetPasswords ? await hashPassword(password) : undefined;
    const fields = {
      ...profile,
      middleName: profile.middleName ?? null,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    };
    await prisma.user.upsert({
      where: { email: profile.email },
      create: { ...fields, password: passwordHash },
      update: passwordHash ? { ...fields, password: passwordHash } : fields,
    });
  }

  console.log(
    `seed-users: created ${toCreate.length}, updated ${toUpdate.length}`,
  );
  logger.info(
    { created: toCreate.length, updated: toUpdate.length, resetPasswords },
    "staff users seeded",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "user seeding failed");
    process.exit(1);
  });
