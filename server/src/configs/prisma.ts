import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { env } from "./env.js";
import { logger } from "./logger.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const queryLoggingEnabled = env.NODE_ENV === "development";

export const prisma = new PrismaClient({
  adapter,
  log: queryLoggingEnabled ? [{ emit: "event", level: "query" }] : [],
});

function toSqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/**
 * Substitutes `$1..$n` placeholders with the actual params for readable
 * dev logs. Returns null when params can't be parsed or a placeholder is
 * out of range — caller falls back to logging them separately.
 */
export function inlineSqlParams(
  query: string,
  paramsJson: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const values: unknown[] = parsed;

  let inRange = true;
  const inlined = query.replace(/\$(\d+)/g, (placeholder, n: string) => {
    const index = Number(n) - 1;
    if (index < 0 || index >= values.length) {
      inRange = false;
      return placeholder;
    }
    return toSqlLiteral(values[index]);
  });
  return inRange ? inlined : null;
}

/** Dev-only Prisma query log: one pretty line with values inlined. */
export function onPrismaQuery(e: Prisma.QueryEvent): void {
  const inlined = inlineSqlParams(e.query, e.params);
  if (inlined !== null) {
    logger.debug({ duration: e.duration }, inlined);
  } else {
    logger.debug({ duration: e.duration, params: e.params }, e.query);
  }
}

if (queryLoggingEnabled) {
  prisma.$on("query", onPrismaQuery);
}
