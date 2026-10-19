import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error.utils.js";
import { requireAuth } from "./auth.middleware.js";

export const requireAdmin: RequestHandler[] = [
  requireAuth,
  (req, _res, next) => {
    if (req.user?.role !== "ADMIN") {
      throw new ApiError(403, "Admin access required", "FORBIDDEN");
    }
    next();
  },
];
