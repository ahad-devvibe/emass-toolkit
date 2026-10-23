import type { RequestHandler } from "express";
import type { UserRole } from "@prisma/client";
import { ACCESS_TOKEN_COOKIE } from "../configs/cookie.config.js";
import { ApiError } from "../utils/api-error.utils.js";
import { verifyAccessToken } from "../services/auth/auth.utils.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { userId: string; role: UserRole };
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE] as unknown;
  if (typeof token !== "string" || !token) {
    throw new ApiError(401, "Missing access token", "TOKEN_MISSING");
  }

  const payload = verifyAccessToken(token);
  req.user = { userId: payload.userId, role: payload.role };
  next();
};
