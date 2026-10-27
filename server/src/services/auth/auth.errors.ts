import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";

// Fields that never leave the server: the password hash, internal HubSpot refs
// and the admin's rejection note and block reason
type HiddenUserField =
  | "password"
  | "hubspotContactId"
  | "hubspotSyncedAt"
  | "rejectionReason"
  | "blockReason"
  | "licenseAcceptedAt"
  | "licenseVersion"
  | "downloadCount"
  | "firstDownloadAt"
  | "firstDownloadLabel"
  | "lastDownloadAt"
  | "lastDownloadLabel"
  | "hubspotSyncedDownloads"
  | "hubspotNoteSentAt";

export function presentUser<T extends { password?: string | null }>(
  user: T,
): Omit<T, HiddenUserField> {
  const rest = { ...user } as Record<string, unknown>;
  delete rest.password;
  delete rest.hubspotContactId;
  delete rest.hubspotSyncedAt;
  delete rest.rejectionReason;
  delete rest.blockReason;
  delete rest.licenseAcceptedAt;
  delete rest.licenseVersion;
  // Download counters and HubSpot sync progress are internal bookkeeping
  for (const field of [
    "downloadCount",
    "firstDownloadAt",
    "firstDownloadLabel",
    "lastDownloadAt",
    "lastDownloadLabel",
    "hubspotSyncedDownloads",
    "hubspotNoteSentAt",
  ]) {
    delete rest[field];
  }
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
