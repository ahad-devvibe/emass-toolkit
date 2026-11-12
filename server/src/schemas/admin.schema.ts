import { z } from "zod";

// The body is optional: rejecting without a reason sends `{}` or nothing
export const rejectSignupSchema = z.object({
  reason: z
    .string({ error: "Reason must be text" })
    .trim()
    .max(500, "Reason must be at most 500 characters")
    .optional(),
});

// Query string for GET /admin/signups/pending (cursor pagination + search)
export const listPendingSignupsSchema = z.object({
  limit: z.coerce
    .number({ error: "Limit must be a number" })
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(50, "Limit must be at most 50")
    .default(20),
  cursor: z.string({ error: "Cursor must be text" }).min(1).optional(),
  q: z
    .string({ error: "Search must be text" })
    .trim()
    .max(100, "Search must be at most 100 characters")
    .optional(),
});

// Unfinished sign-ups (PENDING_SET_PASSWORD) aren't customers yet, so they
// can't be filtered for
const CUSTOMER_STATUSES = ["ACTIVE", "PENDING_APPROVAL", "BLOCKED"] as const;

// Query string for GET /admin/customers: the signups paging and search, plus
// filters on account status and whether the customer has downloaded anything
export const listCustomersSchema = listPendingSignupsSchema.extend({
  status: z
    .enum(CUSTOMER_STATUSES, {
      error: `Status must be one of ${CUSTOMER_STATUSES.join(", ")}`,
    })
    .optional(),
  downloads: z
    .enum(["any", "none"], { error: "Downloads must be any or none" })
    .optional(),
});

export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
