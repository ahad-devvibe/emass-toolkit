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
