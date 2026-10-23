import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import { listActiveProducts } from "../services/products/products.service.js";

export const list = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await listActiveProducts()));
};
