import type { Request, Response } from "express";
import { checkHubspotConnection } from "../services/hubspot/hubspot-status.service.js";
import { ApiResponse } from "../utils/api-response.utils.js";

export const hubspotStatus = async (_req: Request, res: Response) => {
  const status = await checkHubspotConnection();
  res.json(
    ApiResponse.success({ ...status, checkedAt: new Date().toISOString() }),
  );
};
