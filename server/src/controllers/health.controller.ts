import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";

export const getHealth = (_req: Request, res: Response) => {
  res.json(ApiResponse.ok());
};
