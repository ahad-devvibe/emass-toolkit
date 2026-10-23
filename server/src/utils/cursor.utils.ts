import { ApiError } from "./api-error.utils.js";

// Keyset cursor for lists ordered by (createdAt, id). Opaque to clients:
// base64url of "<ISO createdAt>|<id>". Each service builds its own typed
// `afterCursor` where clause from the decoded value.
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

const invalidCursor = () =>
  new ApiError(400, "Invalid cursor", "INVALID_CURSOR");

export function encodeCursor({ createdAt, id }: KeysetCursor): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(raw: string): KeysetCursor {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const separator = decoded.indexOf("|");
  if (separator <= 0) throw invalidCursor();
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) throw invalidCursor();
  return { createdAt, id };
}
