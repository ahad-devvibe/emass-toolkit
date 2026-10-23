import type { RequestHandler } from "express";
import type { UserRole } from "@prisma/client";
import { ApiError } from "../utils/api-error.utils.js";
import { requireAuth } from "./auth.middleware.js";

/** Signed-in user whose role is one of `roles`; anyone else gets 403. */
export function requireRole(...roles: UserRole[]): RequestHandler[] {
  return [
    requireAuth,
    (req, _res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        throw new ApiError(
          403,
          "You don't have access to this resource",
          "FORBIDDEN",
        );
      }
      next();
    },
  ];
}
