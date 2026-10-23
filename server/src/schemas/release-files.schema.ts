import { ReleaseFileKind, SdkPlatform } from "@prisma/client";
import { z } from "zod";

// Multipart fields arrive as strings; an empty value means "not sent"
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const KIND_MESSAGE = "Kind must be SDK or DOC";
const PLATFORM_MESSAGE = "Platform must be WINDOWS, MACOS or UBUNTU";

/**
 * Multipart fields sent before the file part of POST /releases/:id/files.
 * Both are optional: an undetected file uploads unmapped and gets its type
 * when the draft is saved. A detected SDK comes with its platform.
 */
export const uploadFieldsSchema = z
  .object({
    kind: z.preprocess(
      blankToUndefined,
      z.enum(ReleaseFileKind, { error: KIND_MESSAGE }).optional(),
    ),
    platform: z.preprocess(
      blankToUndefined,
      z.enum(SdkPlatform, { error: PLATFORM_MESSAGE }).optional(),
    ),
    replace: z.preprocess(
      blankToUndefined,
      z.guid({ error: "Replace must be a file id" }).optional(),
    ),
  })
  .superRefine((fields, ctx) => {
    const problem =
      fields.kind === ReleaseFileKind.SDK && !fields.platform
        ? "Platform is required for an SDK"
        : fields.kind === ReleaseFileKind.DOC && fields.platform
          ? "Docs don't have a platform"
          : !fields.kind && fields.platform
            ? "Choose a type before a platform"
            : null;
    if (problem)
      ctx.addIssue({ code: "custom", path: ["platform"], message: problem });
  });

/**
 * One file's mapping in PATCH /releases/:id. A draft may hold an unmapped
 * file (kind null) or an SDK still waiting for its platform; only docs and
 * unmapped files must not carry a platform. Submit checks completeness.
 */
const fileMappingSchema = z
  .object({
    id: z.guid({
      error: (iss) =>
        iss.input === undefined
          ? "File id is required"
          : "File id must be a valid id",
    }),
    kind: z.enum(ReleaseFileKind, { error: KIND_MESSAGE }).nullable(),
    platform: z
      .enum(SdkPlatform, { error: PLATFORM_MESSAGE })
      .nullable()
      .optional(),
  })
  .superRefine((mapping, ctx) => {
    if (mapping.kind !== ReleaseFileKind.SDK && mapping.platform) {
      ctx.addIssue({
        code: "custom",
        path: ["platform"],
        message: "Only SDKs have a platform",
      });
    }
  });

export const fileMappingsSchema = z
  .array(fileMappingSchema, { error: "Files must be a list of mappings" })
  .max(100, "At most 100 files per save")
  .refine(
    (mappings) => new Set(mappings.map((m) => m.id)).size === mappings.length,
    {
      error: "Each file can appear only once",
    },
  );

// The file part's own name, as the browser sent it
export const uploadFileNameSchema = z
  .string({ error: "The file needs a name" })
  .min(1, "The file needs a name")
  .max(255, "File names can be at most 255 characters")
  // eslint-disable-next-line no-control-regex
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), {
    error: "File names can't contain control characters",
  });

export const fileIdSchema = z.guid();
