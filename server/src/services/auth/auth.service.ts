import { AuthEventType, OtpPurpose, UserStatus } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import {
  DUMMY_PASSWORD_HASH,
  normalizeEmail,
  verifyPassword,
} from "./auth.utils.js";
import { presentUser } from "./auth.errors.js";
import {
  recordAuthEvent,
  recordSignInFailure,
  type RequestMeta,
} from "./auth-events.service.js";
import { issueOtp, verifyOtp } from "./otp.service.js";
import {
  issueTokenPair,
  refreshTokens,
  revokeRefreshToken,
} from "./token.service.js";
import { resendSignupCode } from "./signup.service.js";
// TODO(auth-otp-signup): unused since OTP signup, remove later. Re-exported
// for the unmounted set-password controllers.
import {
  redeemSetPasswordToken,
  resendSetPasswordEmail,
} from "./set-password.service.js";

// Signup lives in signup.service.ts
export { redeemSetPasswordToken, resendSetPasswordEmail };

export async function resendOtp(
  emailInput: string,
  purpose: OtpPurpose = OtpPurpose.MFA_LOGIN,
  sender: EmailSender = emailService,
): Promise<void> {
  if (purpose === OtpPurpose.SIGNUP_VERIFY) {
    return resendSignupCode(emailInput, sender);
  }
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }
  assertMfaEligible(user);

  await sender.assertReady();
  const code = await issueOtp(user.id, OtpPurpose.MFA_LOGIN);
  await sender.sendMfaLoginEmail(user.email, code);
}

function assertMfaEligible(user: { role: string; status: UserStatus }): void {
  if (user.status !== UserStatus.ACTIVE) {
    throw new ApiError(403, "Account is not active", "ACCOUNT_NOT_ACTIVE");
  }
  if (user.role !== "DEV" && user.role !== "ADMIN") {
    throw new ApiError(
      403,
      "Multi-factor login is not available for this account",
      "MFA_NOT_ALLOWED",
    );
  }
}

/**
 * Password step. A customer is signed in here; staff get an MFA code and are
 * signed in by verifyLoginOtp. Successes and refusals go to the audit trail.
 */
export async function loginEmail(
  input: { email: string; password: string },
  meta: RequestMeta = {},
) {
  try {
    const result = await checkPassword(input);
    if (!result.mfaRequired) {
      await recordAuthEvent(
        {
          type: AuthEventType.SIGN_IN_SUCCEEDED,
          email: result.user.email,
          userId: result.user.id,
        },
        meta,
      );
    }
    return result;
  } catch (err) {
    await recordSignInFailure(input.email, err, meta);
    throw err;
  }
}

async function checkPassword(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(input.email) },
  });
  const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH;
  if (!user || !user.password) {
    await verifyPassword(input.password, passwordHash);
    throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const passwordOk = await verifyPassword(input.password, passwordHash);
  if (!passwordOk) {
    throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (user.status === UserStatus.BLOCKED) {
    throw new ApiError(403, "Account is blocked", "ACCOUNT_BLOCKED");
  }
  if (user.status === UserStatus.PENDING_APPROVAL) {
    throw new ApiError(
      403,
      "Your account is pending approval",
      "ACCOUNT_PENDING_APPROVAL",
    );
  }
  if (user.status === UserStatus.PENDING_SET_PASSWORD) {
    throw new ApiError(403, "Account is not active", "ACCOUNT_NOT_ACTIVE");
  }

  if (user.role === "DEV" || user.role === "ADMIN") {
    await emailService.assertReady();
    const code = await issueOtp(user.id, OtpPurpose.MFA_LOGIN);
    await emailService.sendMfaLoginEmail(user.email, code);
    return { mfaRequired: true as const };
  }

  const tokens = await issueTokenPair(user.id, user.role);
  return { mfaRequired: false as const, ...tokens, user: presentUser(user) };
}

export async function verifyLoginOtp(
  emailInput: string,
  code: string,
  meta: RequestMeta = {},
) {
  try {
    const result = await checkLoginOtp(emailInput, code);
    await recordAuthEvent(
      {
        type: AuthEventType.SIGN_IN_SUCCEEDED,
        email: result.user.email,
        userId: result.user.id,
      },
      meta,
    );
    return result;
  } catch (err) {
    await recordSignInFailure(emailInput, err, meta);
    throw err;
  }
}

async function checkLoginOtp(emailInput: string, code: string) {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }
  assertMfaEligible(user);

  return prisma.$transaction(async (tx) => {
    await verifyOtp(user.id, OtpPurpose.MFA_LOGIN, code, tx);
    const tokens = await issueTokenPair(user.id, user.role, tx);
    return { ...tokens, user: presentUser(user) };
  });
}

export async function refresh(refreshToken: string) {
  return refreshTokens(refreshToken);
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });
  return presentUser(user);
}
