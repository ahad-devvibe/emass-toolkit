import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import { catalogProductIdSchema } from "../schemas/catalog.schema.js";
import {
  getCatalogProduct,
  listCatalogProducts,
} from "../services/catalog/catalog.service.js";
import { createDownload } from "../services/downloads/downloads.service.js";
import {
  acceptLicense,
  getLicense,
} from "../services/licenses/license.service.js";
import { productNotFound } from "../services/releases/releases.errors.js";
import { ApiError } from "../utils/api-error.utils.js";

export const listProducts = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await listCatalogProducts()));
};

// A malformed id can't match any product, so it's a 404 like an unknown one
export const getProduct = async (req: Request, res: Response) => {
  const parsed = catalogProductIdSchema.safeParse(req.params.id);
  if (!parsed.success) throw productNotFound();
  res.json(ApiResponse.success(await getCatalogProduct(parsed.data)));
};

// requireAuth runs first, so req.user is set; a malformed id is a 404 too
export const downloadFile = async (req: Request, res: Response) => {
  const parsed = catalogProductIdSchema.safeParse(req.params.fileId);
  if (!parsed.success) {
    throw ApiError.notFound("This file isn't available", "FILE_NOT_FOUND");
  }
  res.json(
    ApiResponse.success(
      await createDownload(
        { userId: req.user!.userId, role: req.user!.role },
        parsed.data,
      ),
      "Download ready",
    ),
  );
};

export const license = async (req: Request, res: Response) => {
  res.json(ApiResponse.success(await getLicense(req.user!.userId)));
};

export const acceptLicenseTerms = async (req: Request, res: Response) => {
  res.json(
    ApiResponse.success(
      await acceptLicense(req.user!.userId),
      "Licence accepted",
    ),
  );
};
