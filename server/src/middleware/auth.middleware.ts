import type { RequestHandler } from "express";
import type { UserRole } from "@prisma/client";
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
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "Missing access token", "TOKEN_MISSING");
  }

  const token = header.slice("Bearer ".length);
  const payload = verifyAccessToken(token);
  req.user = { userId: payload.userId, role: payload.role };
  next();
};
