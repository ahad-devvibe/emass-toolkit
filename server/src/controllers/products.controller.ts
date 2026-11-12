import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import {
  externalProductSchema,
  productIdSchema,
} from "../schemas/products.schema.js";
import {
  listActiveProducts,
  listExternalProducts,
  updateExternalProduct,
} from "../services/products/products.service.js";
import { productNotFound } from "../services/releases/releases.errors.js";

export const list = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await listActiveProducts()));
};

export const listExternal = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await listExternalProducts()));
};

export const updateExternal = async (req: Request, res: Response) => {
  // A malformed id can't match any product, so it's a 404 like an unknown one
  const id = productIdSchema.safeParse(req.params.id);
  if (!id.success) throw productNotFound();
  const body = externalProductSchema.parse(req.body ?? {});
  res.json(
    ApiResponse.success(
      await updateExternalProduct(id.data, body),
      "External product updated",
    ),
  );
};
