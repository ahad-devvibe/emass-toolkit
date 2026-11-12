import type { Request, Response } from "express";
import { listCustomersSchema } from "../schemas/admin.schema.js";
import { listCustomers } from "../services/admin/customers.service.js";
import { ApiResponse } from "../utils/api-response.utils.js";

export const list = async (req: Request, res: Response) => {
  const query = listCustomersSchema.parse(req.query);
  res.json(ApiResponse.success(await listCustomers(query)));
};
