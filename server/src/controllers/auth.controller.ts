import type { Request, Response } from "express";
import { OtpPurpose } from "@prisma/client";
import { ApiResponse } from "../utils/api-response.utils.js";
import { ApiError } from "../utils/api-error.utils.js";
import {
  forgotPasswordSchema,
  loginSchema,
  resendOtpSchema,
  resendSetPasswordSchema,
  resetPasswordSchema,
  setPasswordSchema,
  signupCompleteSchema,
  signupSchema,
  signupVerifySchema,
  verifyOtpSchema,
} from "../schemas/auth.schema.js";
import * as authService from "../services/auth/auth.service.js";
import * as signupService from "../services/auth/signup.service.js";
import { getSetPasswordInvite } from "../services/auth/set-password.service.js";
import { createCaptchaChallenge } from "../services/captcha/captcha.service.js";
import {
  ACCESS_COOKIE_PATH,
  ACCESS_TOKEN_COOKIE,
  CAPTCHA_COOKIE,
  LEGACY_REFRESH_COOKIE_PATH,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE,
  accessCookieOptions,
  captchaCookieOptions,
  refreshCookieOptions,
} from "../configs/cookie.config.js";
import type { TokenPair } from "../services/auth/token.service.js";

function setAuthCookies(
  res: Response,
  { accessToken, refreshToken }: TokenPair,
) {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: LEGACY_REFRESH_COOKIE_PATH });
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, accessCookieOptions);
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions);
}

function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: ACCESS_COOKIE_PATH });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_COOKIE_PATH });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: LEGACY_REFRESH_COOKIE_PATH });
}

function readRefreshCookie(req: Request): string | undefined {
  const value = req.cookies?.[REFRESH_TOKEN_COOKIE] as unknown;
  return typeof value === "string" && value ? value : undefined;
}

export const captcha = async (_req: Request, res: Response) => {
  const challenge = createCaptchaChallenge();
  res.cookie(CAPTCHA_COOKIE, challenge.cookieValue, captchaCookieOptions);
  res.json(ApiResponse.success({ image: challenge.image }));
};

export const signup = async (req: Request, res: Response) => {
  const input = signupSchema.parse(req.body);
  const captchaCookie = req.cookies?.[CAPTCHA_COOKIE] as string | undefined;
  const result = await signupService.signup(input, captchaCookie);
  res.clearCookie(CAPTCHA_COOKIE, { path: "/" });
  res
    .status(201)
    .json(
      ApiResponse.success(result, "Verification code sent to your email", 201),
    );
};

export const signupVerify = async (req: Request, res: Response) => {
  const input = signupVerifySchema.parse(req.body);
  await signupService.verifySignupCode(input.email, input.code);
  res.json(ApiResponse.ok("Email verified"));
};

export const signupComplete = async (req: Request, res: Response) => {
  const input = signupCompleteSchema.parse(req.body);
  const { user, tokens } = await signupService.completeSignup(
    input.email,
    input.code,
    input.password,
  );
  if (tokens) {
    setAuthCookies(res, tokens);
    res.json(ApiResponse.success({ user, signedIn: true }, "Account created"));
    return;
  }
  res.json(
    ApiResponse.success(
      { user, signedIn: false },
      "Account created — pending team review",
    ),
  );
};

export const login = async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const result = await authService.loginEmail(input);
  if (result.mfaRequired) {
    res.json(
      ApiResponse.success(
        { mfaRequired: true },
        "Verification code sent to your email",
      ),
    );
    return;
  }
  const { accessToken, refreshToken, ...body } = result;
  setAuthCookies(res, { accessToken, refreshToken });
  res.json(ApiResponse.success(body, "Logged in"));
};

export const resendOtp = async (req: Request, res: Response) => {
  const input = resendOtpSchema.parse(req.body);
  await authService.resendOtp(input.email, input.purpose);
  res.json(ApiResponse.ok("OTP sent"));
};

export const forgotPassword = async (req: Request, res: Response) => {
  const input = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(input.email);
  res.json(ApiResponse.ok("OTP sent to your email"));
};

export const verifyOtp = async (req: Request, res: Response) => {
  const input = verifyOtpSchema.parse(req.body);
  if (input.purpose === OtpPurpose.PASSWORD_RESET) {
    await authService.validateResetOtp(input.email, input.code);
    res.json(ApiResponse.ok("OTP verified"));
    return;
  }
  const { accessToken, refreshToken, ...body } =
    await authService.verifyLoginOtp(input.email, input.code);
  setAuthCookies(res, { accessToken, refreshToken });
  res.json(ApiResponse.success(body, "Logged in"));
};

// TODO(auth-otp-signup): unused since OTP signup, remove later. The three
// set-password handlers below are no longer mounted in auth.routes.ts.
export const getSetPassword = async (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  const invite = await getSetPasswordInvite(token);
  res.json(ApiResponse.success(invite));
};

export const setPassword = async (req: Request, res: Response) => {
  const input = setPasswordSchema.parse(req.body);
  await authService.redeemSetPasswordToken(input.token, input.password);
  res.json(ApiResponse.ok("Password set — you can now sign in"));
};

export const resendSetPassword = async (req: Request, res: Response) => {
  const input = resendSetPasswordSchema.parse(req.body);
  await authService.resendSetPasswordEmail(input.email);
  res.json(ApiResponse.ok("Set-password email sent"));
};

export const resetPassword = async (req: Request, res: Response) => {
  const input = resetPasswordSchema.parse(req.body);
  await authService.resetPasswordWithOtp(
    input.email,
    input.code,
    input.newPassword,
  );
  res.json(ApiResponse.ok("Password reset — sign in with your new password"));
};

export const refresh = async (req: Request, res: Response) => {
  const current = readRefreshCookie(req);
  if (!current) {
    throw new ApiError(401, "Missing refresh token", "REFRESH_TOKEN_MISSING");
  }
  setAuthCookies(res, await authService.refresh(current));
  res.json(ApiResponse.ok("Tokens refreshed"));
};

export const logout = async (req: Request, res: Response) => {
  const refreshToken = readRefreshCookie(req);
  if (refreshToken) await authService.logout(refreshToken);
  clearAuthCookies(res);
  res.json(ApiResponse.ok("Logged out"));
};

export const getMe = async (req: Request, res: Response) => {
  const result = await authService.getMe(req.user!.userId);
  res.json(ApiResponse.success(result));
};
