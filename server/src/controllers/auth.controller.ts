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
  signupSchema,
  verifyOtpSchema,
} from "../schemas/auth.schema.js";
import * as authService from "../services/auth/auth.service.js";
import { getSetPasswordInvite } from "../services/auth/set-password.service.js";
import { createCaptchaChallenge } from "../services/captcha/captcha.service.js";
import {
  CAPTCHA_COOKIE,
  LEGACY_REFRESH_COOKIE_PATH,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE,
  captchaCookieOptions,
  refreshCookieOptions,
} from "../configs/cookie.config.js";

// The refresh token only ever travels in the httpOnly cookie; the access
// token is returned in the body and sent back as a Bearer header.
function setRefreshCookie(res: Response, refreshToken: string) {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: LEGACY_REFRESH_COOKIE_PATH });
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions);
}

function clearRefreshCookie(res: Response) {
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
  const user = await authService.signup(input, captchaCookie);
  res.clearCookie(CAPTCHA_COOKIE, { path: "/" });
  const message =
    user.status === "PENDING_APPROVAL"
      ? "Account created — pending team review"
      : "Account created — check your email to set your password";
  res.status(201).json(ApiResponse.success(user, message, 201));
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
  const { refreshToken, ...body } = result;
  setRefreshCookie(res, refreshToken);
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
  const { refreshToken, ...body } = await authService.verifyLoginOtp(
    input.email,
    input.code,
  );
  setRefreshCookie(res, refreshToken);
  res.json(ApiResponse.success(body, "Logged in"));
};

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
  const { accessToken, refreshToken } = await authService.refresh(current);
  setRefreshCookie(res, refreshToken);
  res.json(ApiResponse.success({ accessToken }, "Tokens refreshed"));
};

export const logout = async (req: Request, res: Response) => {
  const refreshToken = readRefreshCookie(req);
  if (refreshToken) await authService.logout(refreshToken);
  clearRefreshCookie(res);
  res.json(ApiResponse.ok("Logged out"));
};

export const getMe = async (req: Request, res: Response) => {
  const result = await authService.getMe(req.user!.userId);
  res.json(ApiResponse.success(result));
};
