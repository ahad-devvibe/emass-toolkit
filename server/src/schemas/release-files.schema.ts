import { ReleaseFileKind, SdkPlatform } from "@prisma/client";
import { z } from "zod";

// Multipart fields arrive as strings; an empty value means "not sent"
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const KIND_MESSAGE = "Kind must be SDK or DOC";
const PLATFORM_MESSAGE = "Platform must be WINDOWS, MACOS or UBUNTU";
const SHA256 = /^[0-9a-f]{64}$/i;
const SHA256_MESSAGE = "SHA-256 must be 64 hexadecimal characters";

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
    // What the browser hashed; the server compares it with what arrived
    sha256: z.preprocess(
      blankToUndefined,
      z
        .string({
          error: (iss) =>
            iss.input === undefined
              ? "SHA-256 is required"
              : "SHA-256 must be text",
        })
        .regex(SHA256, SHA256_MESSAGE)
        .transform((hash) => hash.toLowerCase()),
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

const required = (label: string, type: string) => ({
  error: (iss: { input: unknown }) =>
    iss.input === undefined
      ? `${label} is required`
      : `${label} must be ${type}`,
});

/**
 * POST /releases/:id/files/check. The browser sends the file's name and size,
 * then the byte ranges the server asks for (base64), and finally its SHA-256.
 * Range alignment, bounds and total size are checked by the service, against
 * `size`, with their own error codes.
 */
export const fileCheckSchema = z.object({
  name: z.string(required("Name", "text")).pipe(uploadFileNameSchema),
  size: z
    .number(required("Size", "a number"))
    .int("Size must be a whole number of bytes")
    .positive("Size must be at least 1 byte"),
  sha256: z
    .string({ error: "SHA-256 must be text" })
    .regex(SHA256, SHA256_MESSAGE)
    .transform((hash) => hash.toLowerCase())
    .optional(),
  replace: z.guid({ error: "Replace must be a file id" }).optional(),
  ranges: z
    .array(
      z.object({
        offset: z
          .number(required("Range offset", "a number"))
          .int("Range offsets must be whole numbers")
          .nonnegative("Range offsets can't be negative"),
        data: z
          .string(required("Range data", "base64 text"))
          .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Range data must be base64"),
      }),
      { error: "Ranges must be a list" },
    )
    .max(256, "At most 256 ranges per check")
    .default([]),
});

export type FileCheckInput = z.infer<typeof fileCheckSchema>;
