import type { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";

// Keyset cursor for the pending-signups list, ordered by (createdAt, id).
// Opaque to clients: base64url of "<ISO createdAt>|<id>".
export interface SignupCursor {
  createdAt: Date;
  id: string;
}

const invalidCursor = () =>
  new ApiError(400, "Invalid cursor", "INVALID_CURSOR");

export function encodeCursor({ createdAt, id }: SignupCursor): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(raw: string): SignupCursor {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const separator = decoded.indexOf("|");
  if (separator <= 0) throw invalidCursor();
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) throw invalidCursor();
  return { createdAt, id };
}

/** Rows strictly after the cursor in (createdAt, id) order. */
export function afterCursor(cursor: SignupCursor): Prisma.UserWhereInput {
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
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
