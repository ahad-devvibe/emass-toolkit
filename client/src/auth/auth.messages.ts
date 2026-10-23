import { ApiRequestError } from "@/lib/api/http"

// Friendlier copy for the server's auth error codes; anything else falls back to the server message
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "That email and password don't match. Check them and try again.",
  ACCOUNT_PENDING_APPROVAL: "Your account is still being reviewed by our team. We'll email you once it's approved.",
  ACCOUNT_NOT_ACTIVE: "This account isn't active yet. If you started signing up, sign up again with this email to finish.",
  ACCOUNT_BLOCKED: "This account can't sign in. Contact your Nanoveu representative if you think this is a mistake.",
  OTP_INVALID: "That code isn't right. Check the latest email and try again.",
  OTP_EXPIRED: "That code has expired. Send a new one and try again.",
  OTP_ATTEMPTS_EXCEEDED: "Too many attempts with that code. Send a new one.",
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  DOMAIN_BLOCKED: "We can't create an account for this email domain.",
  CAPTCHA_INVALID: "The characters didn't match. Try the new image.",
  CAPTCHA_EXPIRED: "The image expired. Try the new one.",
  CAPTCHA_REQUIRED: "Reload the image and enter the characters shown.",
  EMAIL_SEND_FAILED: "We couldn't send the email just now. Try again in a moment.",
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return messages[error.code] ?? error.message
  return "Something went wrong. Try again."
}

export const errorCode = (error: unknown) => (error instanceof ApiRequestError ? error.code : undefined)
