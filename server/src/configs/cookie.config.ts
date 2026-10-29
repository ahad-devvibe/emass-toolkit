import { ACCESS_TOKEN_TTL_MS } from "../services/auth/auth.utils.js";
import { env } from "./env.js";

export const ACCESS_TOKEN_COOKIE = "accessToken" as const;
export const REFRESH_TOKEN_COOKIE = "refreshToken" as const;
export const CAPTCHA_COOKIE = "captcha" as const;

// Scoped to /api/auth so both /refresh and /logout receive it
export const REFRESH_COOKIE_PATH = "/api/auth";
// Path used before the logout fix; cleared so stale cookies don't linger
export const LEGACY_REFRESH_COOKIE_PATH = "/api/auth/refresh";

// Sent to every API route; lives exactly as long as the JWT inside it.
export const ACCESS_COOKIE_PATH = "/api";

export type SameSite = "strict" | "lax" | "none";

/**
 * Every auth cookie's options. SameSite=None (a client on another site than
 * the API) needs Secure, or browsers drop the cookie. Cross-site requests are
 * kept out by the CORS origin check in app.ts, which refuses any origin not
 * allowed before a route runs. The `clear…` variants carry the same
 * attributes without maxAge: a cross-site response that clears a cookie must
 * also say SameSite=None; Secure, or the browser ignores it.
 */
export function cookieOptions(sameSite: SameSite, production: boolean) {
  const base = {
    httpOnly: true,
    secure: production || sameSite === "none",
    sameSite,
  };
  const access = { ...base, path: ACCESS_COOKIE_PATH };
  const refresh = { ...base, path: REFRESH_COOKIE_PATH };
  const legacyRefresh = { ...base, path: LEGACY_REFRESH_COOKIE_PATH };
  const captcha = { ...base, path: "/" };
  return {
    access: { ...access, maxAge: ACCESS_TOKEN_TTL_MS },
    refresh: { ...refresh, maxAge: 14 * 24 * 60 * 60 * 1000 },
    captcha: { ...captcha, maxAge: 10 * 60 * 1000 },
    clearAccess: access,
    clearRefresh: refresh,
    clearLegacyRefresh: legacyRefresh,
    clearCaptcha: captcha,
  };
}

const options = cookieOptions(
  env.COOKIE_SAME_SITE,
  process.env.NODE_ENV === "production",
);

export const accessCookieOptions = options.access;
export const refreshCookieOptions = options.refresh;
export const captchaCookieOptions = options.captcha;
export const clearAccessCookieOptions = options.clearAccess;
export const clearRefreshCookieOptions = options.clearRefresh;
export const clearLegacyRefreshCookieOptions = options.clearLegacyRefresh;
export const clearCaptchaCookieOptions = options.clearCaptcha;
