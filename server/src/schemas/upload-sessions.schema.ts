import { ReleaseFileKind, SdkPlatform } from "@prisma/client";
import { z } from "zod";
import { uploadFileNameSchema } from "./release-files.schema.js";

const required = (label: string, type: string) => ({
  error: (iss: { input: unknown }) =>
    iss.input === undefined
      ? `${label} is required`
      : `${label} must be ${type}`,
});

/**
 * POST /releases/:id/uploads. The browser has checked and hashed the file;
 * this opens (or finds) its upload session. A detected SDK comes with its
 * platform; an undetected file uploads unmapped.
 */
export const uploadCreateSchema = z
  .object({
    name: z.string(required("Name", "text")).pipe(uploadFileNameSchema),
    size: z
      .number(required("Size", "a number"))
      .int("Size must be a whole number of bytes")
      .positive("Size must be at least 1 byte"),
    sha256: z
      .string(required("SHA-256", "text"))
      .regex(/^[0-9a-f]{64}$/i, "SHA-256 must be 64 hexadecimal characters")
      .transform((hash) => hash.toLowerCase()),
    contentType: z
      .string({ error: "Content type must be text" })
      .max(255, "Content type can be at most 255 characters")
      .optional(),
    kind: z
      .enum(ReleaseFileKind, { error: "Kind must be SDK or DOC" })
      .optional(),
    platform: z
      .enum(SdkPlatform, {
        error: "Platform must be WINDOWS, MACOS or UBUNTU",
      })
      .optional(),
    replace: z.guid({ error: "Replace must be a file id" }).optional(),
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

export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;

export const uploadIdSchema = z.guid();

// Path segment, so it arrives as text
export const partNumberSchema = z.coerce
  .number({ error: "Part number must be a number" })
  .int("Part number must be a whole number")
  .min(1, "Part numbers start at 1");
