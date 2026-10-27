import type { Request, Response } from "express";
import { getDashboard } from "../services/admin/dashboard.service.js";
import { ApiResponse } from "../utils/api-response.utils.js";

export const dashboard = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await getDashboard()));
};
