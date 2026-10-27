import { EmailDomainKind } from "@prisma/client";
import { z } from "zod";
import { normalizeDomainInput } from "../services/auth/domains.utils.js";

// POST /admin/domains; the domain is normalised ("@Gmail.com" → "gmail.com")
export const addDomainSchema = z.object({
  domain: z
    .string({
      error: (iss) =>
        iss.input === undefined ? "Domain is required" : "Domain must be text",
    })
    .transform((value, ctx) => {
      const domain = normalizeDomainInput(value);
      if (!domain) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a domain like example.com",
        });
        return z.NEVER;
      }
      return domain;
    }),
  kind: z.enum(EmailDomainKind, {
    error: (iss) =>
      iss.input === undefined
        ? "List is required"
        : "List must be FREE_MAIL or COMPETITOR",
  }),
});

export const domainIdSchema = z.guid({ error: "Domain id must be a valid id" });
