import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import {
  approveSignup,
  listPendingSignups,
  rejectSignup,
} from "../services/auth/admin-signups.service.js";

export const listPending = async (_req: Request, res: Response) => {
  const users = await listPendingSignups();
  res.json(ApiResponse.success({ signups: users }));
};

export const approve = async (req: Request, res: Response) => {
  const user = await approveSignup(String(req.params.id ?? ""));
  res.json(ApiResponse.success(user, "Signup approved"));
};

export const reject = async (req: Request, res: Response) => {
  const user = await rejectSignup(String(req.params.id ?? ""));
  res.json(ApiResponse.success(user, "Signup rejected"));
};
