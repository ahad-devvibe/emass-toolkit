import { createHash } from "node:crypto";
import svgCaptcha from "svg-captcha";
import jwt from "jsonwebtoken";
import { env } from "../../configs/env.js";
import { ApiError } from "../../utils/api-error.utils.js";

/** No 0/O, 1/I, 5/S look-alikes — keeps the widget honest for humans. */
export const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
export const CAPTCHA_LENGTH = 6;

const CAPTCHA_JWT_KIND = "captcha";

export interface CaptchaChallenge {
  /** data: URI ready for an <img> tag */
  image: string;
  /** httpOnly cookie value to send with the challenge */
  cookieValue: string;
}

function hashCaptchaCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase()).digest("hex");
}

export function createCaptchaChallenge(): CaptchaChallenge {
  const svg = svgCaptcha.create({
    size: CAPTCHA_LENGTH,
    charPreset: CAPTCHA_ALPHABET,
    noise: 3,
    color: true,
    background: "#f4f1ec",
  });
  const expected = svg.text;
  const cookieValue = jwt.sign(
    { kind: CAPTCHA_JWT_KIND, h: hashCaptchaCode(expected) },
    env.JWT_SECRET,
    { expiresIn: env.CAPTCHA_TTL_SECONDS },
  );
  return {
    image: `data:image/svg+xml;base64,${Buffer.from(svg.data).toString("base64")}`,
    cookieValue,
  };
}

export function verifyCaptcha(
  typedCode: string | undefined,
  cookieValue: string | undefined,
): void {
  if (!cookieValue) {
    throw new ApiError(400, "Captcha is required", "CAPTCHA_REQUIRED");
  }
  if (!typedCode?.trim()) {
    throw new ApiError(400, "Captcha code is required", "CAPTCHA_INVALID");
  }

  let payload: unknown;
  try {
    payload = jwt.verify(cookieValue, env.JWT_SECRET);
  } catch {
    throw new ApiError(400, "Captcha has expired", "CAPTCHA_EXPIRED");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as { kind?: unknown }).kind !== CAPTCHA_JWT_KIND ||
    typeof (payload as { h?: unknown }).h !== "string"
  ) {
    throw new ApiError(400, "Captcha is invalid", "CAPTCHA_INVALID");
  }

  const expectedHash = (payload as { h: string }).h;
  if (hashCaptchaCode(typedCode) !== expectedHash) {
    throw new ApiError(400, "Captcha code does not match", "CAPTCHA_INVALID");
  }
}
