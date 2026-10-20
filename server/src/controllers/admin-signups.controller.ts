import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import {
  listPendingSignupsSchema,
  rejectSignupSchema,
} from "../schemas/admin.schema.js";
import {
  approveSignup,
  listPendingSignups,
  rejectSignup,
} from "../services/auth/admin-signups.service.js";

export const listPending = async (req: Request, res: Response) => {
  const query = listPendingSignupsSchema.parse(req.query);
  const result = await listPendingSignups(query);
  res.json(ApiResponse.success(result));
};

export const approve = async (req: Request, res: Response) => {
  const user = await approveSignup(String(req.params.id ?? ""));
  res.json(ApiResponse.success(user, "Signup approved"));
};

export const reject = async (req: Request, res: Response) => {
  const { reason } = rejectSignupSchema.parse(req.body ?? {});
  const user = await rejectSignup(
    String(req.params.id ?? ""),
    reason || undefined,
  );
  res.json(ApiResponse.success(user, "Signup rejected"));
};
