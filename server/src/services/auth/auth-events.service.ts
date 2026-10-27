import { AuthEventType } from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { normalizeEmail } from "./auth.utils.js";

/** Who is asking, as seen by the controller (req.ip honours TRUST_PROXY). */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const MAX_USER_AGENT = 256;
const MAX_EMAIL = 320;

interface AuthEventInput {
  type: AuthEventType;
  email: string;
  /** Looked up from the email when omitted (null for unknown addresses). */
  userId?: string | null;
  code?: string | null;
}

/**
 * Best effort: an audit row must never fail or slow a sign-in, so errors are
 * logged and swallowed. Call it outside transactions, so a rolled-back OTP
 * check still records its failure.
 */
export async function recordAuthEvent(
  event: AuthEventInput,
  meta: RequestMeta = {},
): Promise<void> {
  try {
    const email = normalizeEmail(event.email).slice(0, MAX_EMAIL);
    const userId =
      event.userId !== undefined
        ? event.userId
        : ((
            await prisma.user.findUnique({
              where: { email },
              select: { id: true },
            })
          )?.id ?? null);
    await prisma.authEvent.create({
      data: {
        type: event.type,
        email,
        userId,
        code: event.code ?? null,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, type: event.type }, "Couldn't record an auth event");
  }
}

/**
 * Records a refused sign-in. Only client-caused refusals (4xx ApiErrors:
 * wrong password, blocked account, bad code) count; server faults don't.
 */
export async function recordSignInFailure(
  email: string,
  err: unknown,
  meta: RequestMeta,
): Promise<void> {
  if (!(err instanceof ApiError) || err.statusCode >= 500) return;
  await recordAuthEvent(
    { type: AuthEventType.SIGN_IN_FAILED, email, code: err.code },
    meta,
  );
}
