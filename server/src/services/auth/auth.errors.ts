import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";

// Fields that never leave the server: the password hash and internal HubSpot refs
type HiddenUserField = "password" | "hubspotContactId" | "hubspotSyncedAt";

export function presentUser<T extends { password?: string | null }>(
  user: T,
): Omit<T, HiddenUserField> {
  const rest = { ...user } as Record<string, unknown>;
  delete rest.password;
  delete rest.hubspotContactId;
  delete rest.hubspotSyncedAt;
  return rest as Omit<T, HiddenUserField>;
}

export function translateUniqueSignupError(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ApiError(
      409,
      "An account with this email already exists",
      "EMAIL_TAKEN",
    );
  }
}
