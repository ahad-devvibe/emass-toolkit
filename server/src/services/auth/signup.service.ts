import {
  BlockReason,
  OtpPurpose,
  Prisma,
  UserStatus,
  type User,
} from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { verifyCaptcha } from "../captcha/captcha.service.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import {
  hubspotService,
  syncHubspotContact,
  type HubspotClient,
} from "../hubspot/hubspot.service.js";
import { presentUser, translateUniqueSignupError } from "./auth.errors.js";
import { normalizeWebsite } from "../../schemas/auth.schema.js";
import { hashPassword, normalizeEmail } from "./auth.utils.js";
import { classifySignupEmail } from "./domains.service.js";
import { checkOtp, issueOtp, verifyOtp } from "./otp.service.js";
import { issueTokenPair, type TokenPair } from "./token.service.js";

// Signup in three steps, all on the signup page:
//   1. form      → POST /auth/signup           (captcha, domain policy, code emailed)
//   2. code      → POST /auth/signup/verify    (checks the code, doesn't use it up)
//   3. password  → POST /auth/signup/complete  (code + password; account done)
// A company address ends ACTIVE and signed in, with a HubSpot contact; a
// free-mail address ends PENDING_APPROVAL until an admin approves it.
// Until step 3 the user row is an "unfinished signup": PENDING_SET_PASSWORD
// with no password, which can't log in and is resumed by signing up again.

export interface SignupInput {
  email: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  country: string;
  companyName: string;
  jobTitle: string;
  useCase: string;
  website?: string;
  captcha: string;
}

const isUnfinished = (user: Pick<User, "status" | "password">) =>
  user.status === UserStatus.PENDING_SET_PASSWORD && !user.password;

// Same answer for an unknown email and a wrong code, so the endpoints don't
// reveal which addresses have accounts
const invalidCode = () => new ApiError(400, "Invalid OTP", "OTP_INVALID");

const domainBlocked = () =>
  new ApiError(
    403,
    "We are unable to create an account for you right now. Contact: support@nanoveu.com for user profile creation.",
    "DOMAIN_BLOCKED",
  );

export function buildCatalogUrl(): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/catalog`;
}

/**
 * Step 1: validate the form, refuse competitor domains, create (or resume)
 * the unfinished signup and email a 6-digit code. Nothing reaches HubSpot.
 */
export async function signup(
  input: SignupInput,
  captchaCookie: string | undefined,
  sender: EmailSender = emailService,
): Promise<{ email: string }> {
  verifyCaptcha(input.captcha, captchaCookie);
  const email = normalizeEmail(input.email);
  await sender.assertReady();

  const profile = {
    email,
    firstName: input.firstName,
    middleName: input.middleName?.trim() || null,
    lastName: input.lastName,
    country: input.country.toUpperCase(),
    companyName: input.companyName,
    jobTitle: input.jobTitle,
    useCase: input.useCase,
    website: input.website ? normalizeWebsite(input.website) : null,
  };

  if ((await classifySignupEmail(email)) === "COMPETITOR") {
    // Keep an internal audit row (never synced to HubSpot). An existing row
    // for this email is left untouched; the answer is the same either way.
    await prisma.user
      .create({
        data: {
          ...profile,
          status: UserStatus.BLOCKED,
          blockReason: BlockReason.COMPETITOR_DOMAIN,
        },
      })
      .catch((err: unknown) => {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError) ||
          err.code !== "P2002"
        ) {
          throw err;
        }
      });
    throw domainBlocked();
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !isUnfinished(existing)) {
    throw new ApiError(
      409,
      "An account with this email already exists",
      "EMAIL_TAKEN",
    );
  }

  let user: User;
  let created = false;
  if (existing) {
    // Someone who left before finishing signs up again: refresh their details
    user = await prisma.user.update({
      where: { id: existing.id },
      data: profile,
    });
  } else {
    try {
      user = await prisma.user.create({
        data: { ...profile, status: UserStatus.PENDING_SET_PASSWORD },
      });
      created = true;
    } catch (err) {
      translateUniqueSignupError(err);
      throw err;
    }
  }

  try {
    const code = await issueOtp(user.id, OtpPurpose.SIGNUP_VERIFY);
    await sender.sendOtpEmail(user.email, code);
  } catch (err) {
    // A brand-new row without a delivered code is useless; drop it
    if (created) {
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    }
    throw err;
  }

  return { email: user.email };
}

async function findUnfinishedSignup(emailInput: string): Promise<User> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user || !isUnfinished(user)) throw invalidCode();
  return user;
}

/** Step 2: check the code without using it up (step 3 consumes it). */
export async function verifySignupCode(
  email: string,
  code: string,
): Promise<void> {
  const user = await findUnfinishedSignup(email);
  await checkOtp(user.id, OtpPurpose.SIGNUP_VERIFY, code);
}

/** A new code for an unfinished signup; silent for anything else. */
export async function resendSignupCode(
  emailInput: string,
  sender: EmailSender = emailService,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user || !isUnfinished(user)) return;
  await sender.assertReady();
  const code = await issueOtp(user.id, OtpPurpose.SIGNUP_VERIFY);
  await sender.sendOtpEmail(user.email, code);
}

/**
 * Everything that happens when an account becomes ACTIVE (company signup
 * completed, or a free-mail signup approved): the welcome email and the
 * HubSpot contact. Both best-effort; neither can undo the activation.
 */
export async function onAccountActivated(
  user: User,
  sender: EmailSender = emailService,
  hubspot: HubspotClient = hubspotService,
): Promise<void> {
  try {
    await sender.sendWelcomeEmail(
      user.email,
      user.firstName,
      buildCatalogUrl(),
    );
  } catch (err) {
    logger.warn({ err, userId: user.id }, "welcome email failed");
  }
  await syncHubspotContact(user, hubspot);
}

export type CompleteSignupResult = {
  user: ReturnType<typeof presentUser<User>>;
  /** Set for a company address: the caller signs the user in. */
  tokens: TokenPair | null;
};

/**
 * Step 3: use up the code, set the password and finish the account. A
 * company address becomes ACTIVE (and is signed in by the caller); a
 * free-mail address waits for admin approval. The domain is classified
 * again here, so a policy change since step 1 still applies.
 */
export async function completeSignup(
  email: string,
  code: string,
  password: string,
  sender: EmailSender = emailService,
  hubspot: HubspotClient = hubspotService,
): Promise<CompleteSignupResult> {
  const user = await findUnfinishedSignup(email);
  const domainClass = await classifySignupEmail(user.email);
  if (domainClass === "COMPETITOR") throw domainBlocked();
  const status =
    domainClass === "FREE_MAIL"
      ? UserStatus.PENDING_APPROVAL
      : UserStatus.ACTIVE;
  const passwordHash = await hashPassword(password);

  const { account, tokens } = await prisma.$transaction(async (tx) => {
    await verifyOtp(user.id, OtpPurpose.SIGNUP_VERIFY, code, tx);
    // Only an unfinished signup may be finished, once (guards a double submit)
    const updated = await tx.user.updateMany({
      where: {
        id: user.id,
        status: UserStatus.PENDING_SET_PASSWORD,
        password: null,
      },
      data: { password: passwordHash, emailVerified: true, status },
    });
    if (updated.count === 0) throw invalidCode();
    const account = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const tokens =
      status === UserStatus.ACTIVE
        ? await issueTokenPair(account.id, account.role, tx)
        : null;
    return { account, tokens };
  });

  if (status === UserStatus.ACTIVE) {
    await onAccountActivated(account, sender, hubspot);
  } else {
    try {
      await sender.sendPendingApprovalEmail(account.email, account.firstName);
    } catch (err) {
      logger.warn({ err, userId: account.id }, "pending-approval email failed");
    }
  }

  return { user: presentUser(account), tokens };
}
