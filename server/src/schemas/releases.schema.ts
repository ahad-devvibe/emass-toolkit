import { ReleaseStatus } from "@prisma/client";
import { z } from "zod";
import { parseVersion } from "../services/releases/releases.utils.js";
import { fileMappingsSchema } from "./release-files.schema.js";

const VERSION_FORMAT = "Version must look like 1.2.3";
const MAX_NOTES_LENGTH = 50_000;

const versionField = z
  .string({
    error: (iss) =>
      iss.input === undefined ? "Version is required" : "Version must be text",
  })
  .trim()
  .refine((value) => parseVersion(value) !== null, { error: VERSION_FORMAT });

const releaseNotesField = z
  .string({ error: "Release notes must be text" })
  .max(MAX_NOTES_LENGTH, {
    error: "Release notes must be at most 50,000 characters",
  });

const productIdField = z.guid({
  error: (iss) =>
    iss.input === undefined
      ? "Product is required"
      : "Product must be a valid id",
});

export const createReleaseSchema = z.object({
  productId: productIdField,
  version: versionField,
  releaseNotes: releaseNotesField.optional(),
});

// Save draft: version, notes and file type/platform mappings in one request
export const updateReleaseSchema = z
  .object({
    version: versionField.optional(),
    releaseNotes: releaseNotesField.optional(),
    files: fileMappingsSchema.optional(),
  })
  .refine(
    (body) =>
      body.version !== undefined ||
      body.releaseNotes !== undefined ||
      body.files !== undefined,
    { error: "Send a version, release notes or file mappings to update" },
  );

// Query string for GET /releases (cursor pagination, filters, search)
export const listReleasesQuerySchema = z.object({
  // One status or several, comma-separated (the Archived tab also lists
  // rolled-back releases): ?status=ARCHIVED,ROLLED_BACK
  status: z
    .preprocess(
      (value) =>
        typeof value === "string"
          ? value.split(",").map((part) => part.trim())
          : value,
      z
        .array(
          z.enum(ReleaseStatus, {
            error: `Status must be one of ${Object.values(ReleaseStatus).join(", ")}`,
          }),
        )
        .min(1),
    )
    .optional(),
  productId: z.guid({ error: "Product must be a valid id" }).optional(),
  q: z
    .string({ error: "Search must be text" })
    .trim()
    .max(100, "Search must be at most 100 characters")
    .optional(),
  cursor: z.string({ error: "Cursor must be text" }).min(1).optional(),
  limit: z.coerce
    .number({ error: "Limit must be a number" })
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(100, "Limit must be at most 100")
    .default(50),
});

export const nextVersionQuerySchema = z.object({
  productId: productIdField,
});

// Path param; the controller answers 404 rather than 400 when it's not an id
export const releaseIdSchema = z.guid();

// Admin review: feedback and rollback reasons are short free text
function reviewText(label: string) {
  return z
    .string({
      error: (iss) =>
        iss.input === undefined
          ? `${label} is required`
          : `${label} must be text`,
    })
    .trim()
    .min(1, `${label} is required`)
    .max(2000, `${label} can be at most 2,000 characters`);
}

export const requestChangesSchema = z.object({ note: reviewText("Feedback") });

// reason: internal, kept in the release history. customerMessage: optional,
// added to the email sent to everyone who downloaded the release.
export const rollbackSchema = z.object({
  reason: reviewText("A reason"),
  customerMessage: z
    .string({ error: "Message to customers must be text" })
    .trim()
    .max(1000, "Message to customers can be at most 1,000 characters")
    .optional()
    .transform((value) => value || undefined),
});

// Notes on a published release; empty clears them
export const publishedNotesSchema = z.object({
  releaseNotes: z
    .string({
      error: (iss) =>
        iss.input === undefined
          ? "Release notes are required"
          : "Release notes must be text",
    })
    .max(MAX_NOTES_LENGTH, {
      error: "Release notes must be at most 50,000 characters",
    }),
});

// Submitting with file warnings (no version, a doc of another version) is
// allowed only once the developer confirms them
export const submitReleaseSchema = z.object({
  confirmWarnings: z
    .boolean({ error: "Confirm warnings must be true or false" })
    .optional(),
});

export type SubmitReleaseInput = z.infer<typeof submitReleaseSchema>;
