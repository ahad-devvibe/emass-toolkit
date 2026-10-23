import { ACCESS_TOKEN_TTL_MS } from "../services/auth/auth.utils.js";

const isProduction = process.env.NODE_ENV === "production";

export const ACCESS_TOKEN_COOKIE = "accessToken" as const;
export const REFRESH_TOKEN_COOKIE = "refreshToken" as const;
export const CAPTCHA_COOKIE = "captcha" as const;

// Scoped to /api/auth so both /refresh and /logout receive it
export const REFRESH_COOKIE_PATH = "/api/auth";
// Path used before the logout fix; cleared so stale cookies don't linger
export const LEGACY_REFRESH_COOKIE_PATH = "/api/auth/refresh";

// Sent to every API route; lives exactly as long as the JWT inside it.
// SameSite=Strict plus the CORS origin check keep cross-site requests out.
export const ACCESS_COOKIE_PATH = "/api";

export const accessCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: ACCESS_COOKIE_PATH,
  maxAge: ACCESS_TOKEN_TTL_MS,
};

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: REFRESH_COOKIE_PATH,
  maxAge: 14 * 24 * 60 * 60 * 1000,
};

export const captchaCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 10 * 60 * 1000,
};
