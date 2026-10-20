const isProduction = process.env.NODE_ENV === "production";

export const REFRESH_TOKEN_COOKIE = "refreshToken" as const;
export const CAPTCHA_COOKIE = "captcha" as const;

// Scoped to /api/auth so both /refresh and /logout receive it
export const REFRESH_COOKIE_PATH = "/api/auth";
// Path used before the logout fix; cleared so stale cookies don't linger
export const LEGACY_REFRESH_COOKIE_PATH = "/api/auth/refresh";

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
