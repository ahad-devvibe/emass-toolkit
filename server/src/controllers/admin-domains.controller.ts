import type { Request, Response } from "express";
import {
  addDomainSchema,
  domainIdSchema,
} from "../schemas/admin-domains.schema.js";
import {
  addDomainPolicy,
  listDomainPolicies,
  removeDomainPolicy,
} from "../services/auth/domains.service.js";
import { ApiResponse } from "../utils/api-response.utils.js";

export const listDomains = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success({ domains: await listDomainPolicies() }));
};

export const addDomain = async (req: Request, res: Response) => {
  const { domain, kind } = addDomainSchema.parse(req.body);
  const created = await addDomainPolicy(domain, kind);
  res.status(201).json(ApiResponse.success(created, "Domain added", 201));
};

export const removeDomain = async (req: Request, res: Response) => {
  await removeDomainPolicy(domainIdSchema.parse(req.params.id));
  res.json(ApiResponse.ok("Domain removed"));
};
