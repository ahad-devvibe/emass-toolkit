const isProduction = process.env.NODE_ENV === "production";

export const ACCESS_TOKEN_COOKIE = "accessToken" as const;
export const REFRESH_TOKEN_COOKIE = "refreshToken" as const;
export const CAPTCHA_COOKIE = "captcha" as const;

export const accessCookieOptions = {
  httpOnly: false,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 15 * 60 * 1000,
};

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/api/auth/refresh",
  maxAge: 14 * 24 * 60 * 60 * 1000,
};

export const captchaCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 10 * 60 * 1000,
};
