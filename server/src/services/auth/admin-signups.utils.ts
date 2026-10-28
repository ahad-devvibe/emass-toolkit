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

/**
 * Every whitespace-separated term must match a name part or the email, so
 * "jane doe", "doe" and "acme.io" all work. Case-insensitive.
 */
export function searchWhere(q: string | undefined): Prisma.UserWhereInput {
  const terms = q?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (terms.length === 0) return {};
  return {
    AND: terms.map((term) => ({
      OR: (["firstName", "middleName", "lastName", "email"] as const).map(
        (field) => ({ [field]: { contains: term, mode: "insensitive" } }),
      ),
    })),
  };
}
