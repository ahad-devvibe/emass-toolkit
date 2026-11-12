import type { Prisma } from "@prisma/client";
import type { KeysetCursor } from "../../utils/cursor.utils.js";

/** Rows strictly after the cursor in newest-first (createdAt, id) order. */
export function afterCursor(cursor: KeysetCursor): Prisma.UserWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

type SearchField = "firstName" | "middleName" | "lastName" | "email" | "companyName";

/**
 * Every whitespace-separated term must match a name part or the email (or
 * one of `extra`), so "jane doe", "doe" and "acme.io" all work. Case-insensitive.
 */
export function searchWhere(
  q: string | undefined,
  extra: SearchField[] = [],
): Prisma.UserWhereInput {
  const terms = q?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (terms.length === 0) return {};
  const fields: SearchField[] = [
    "firstName",
    "middleName",
    "lastName",
    "email",
    ...extra,
  ];
  return {
    AND: terms.map((term) => ({
      OR: fields.map((field) => ({
        [field]: { contains: term, mode: "insensitive" },
      })),
    })),
  };
}
