import { UserRole } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { LICENSE_TERMS, LICENSE_VERSION } from "./license.terms.js";

const userNotFound = () =>
  ApiError.notFound("User not found", "USER_NOT_FOUND");

/** Staff are EMASS people testing builds; only customers click through. */
const exempt = (role: UserRole) => role !== UserRole.CUSTOMER;

/** GET /catalog/license: the terms, and whether this account has accepted. */
export async function getLicense(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, licenseAcceptedAt: true },
  });
  if (!user) throw userNotFound();
  return {
    version: LICENSE_VERSION,
    ...LICENSE_TERMS,
    accepted: exempt(user.role) || user.licenseAcceptedAt !== null,
    acceptedAt: user.licenseAcceptedAt,
  };
}

/**
 * POST /catalog/license/accept. Once per account: the first acceptance (time
 * and wording version) is kept, so repeating it changes nothing.
 */
export async function acceptLicense(userId: string) {
  await prisma.user.updateMany({
    where: { id: userId, licenseAcceptedAt: null },
    data: { licenseAcceptedAt: new Date(), licenseVersion: LICENSE_VERSION },
  });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { licenseAcceptedAt: true, licenseVersion: true },
  });
  if (!user) throw userNotFound();
  return { acceptedAt: user.licenseAcceptedAt, version: user.licenseVersion };
}

/** Download gate: a customer who hasn't accepted gets 409 LICENSE_REQUIRED. */
export async function assertLicenseAccepted(
  userId: string,
  role: UserRole,
): Promise<void> {
  if (exempt(role)) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { licenseAcceptedAt: true },
  });
  if (!user?.licenseAcceptedAt) {
    throw new ApiError(
      409,
      "Accept the licence to download",
      "LICENSE_REQUIRED",
    );
  }
}
