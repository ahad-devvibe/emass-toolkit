import * as z from "zod";

/**
 * Environment schema — validated eagerly on import so a misconfigured server
 * fails fast with every missing/invalid key listed, instead of crashing later.
 *
 * Cloud credentials (OCI_*) stay optional at boot so dev and test environments
 * can run without cloud access; their presence is enforced lazily by the
 * consuming configs (configs/email.ts, configs/storage.ts) on first use.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"], {
        error:
          "NODE_ENV must be one of development, test, production (or unset)",
      })
      .default("development"),
    PORT: z.coerce
      .number({ error: "PORT must be a number between 1 and 65535" })
      .int({ error: "PORT must be a number between 1 and 65535" })
      .min(1, { error: "PORT must be a number between 1 and 65535" })
      .max(65535, { error: "PORT must be a number between 1 and 65535" })
      .default(5000),
    DATABASE_URL: z
      .string({
        error: (iss) =>
          iss.input === undefined
            ? "DATABASE_URL is required"
            : "DATABASE_URL must be a postgres connection string",
      })
      .min(1, { error: "DATABASE_URL is required" }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
        error:
          "LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent",
      })
      .default("info"),

    // auth feature
    JWT_SECRET: z
      .string({
        error: (iss) =>
          iss.input === undefined
            ? "JWT_SECRET is required"
            : "JWT_SECRET must be a string",
      })
      .min(1, { error: "JWT_SECRET is required" }),
    APP_BASE_URL: z
      .string()
      .default("http://localhost:5173")
      .describe("Frontend origin used to build set-password links"),
    SET_PASSWORD_TTL_HOURS: z.coerce.number().int().positive().default(48),
    SET_PASSWORD_REMINDER_HOURS: z.coerce.number().int().positive().default(24),
    CAPTCHA_TTL_SECONDS: z.coerce.number().int().positive().default(600),

    // email feature
    EMAIL_PROVIDER: z
      .enum(["console", "oci"], {
        error: "EMAIL_PROVIDER must be one of console, oci",
      })
      .default("console"),
    EMAIL_FROM_ADDRESS: z
      .string({
        error: (iss) =>
          iss.input === undefined
            ? "EMAIL_FROM_ADDRESS is required"
            : "EMAIL_FROM_ADDRESS must be a string",
      })
      .optional(),
    EMAIL_FROM_NAME: z.string().optional(),

    // shared OCI auth (email-oci + storage)
    OCI_REGION: z.string().optional(),
    OCI_AUTH_MODE: z
      .enum(["config-file", "instance-principal"], {
        error: "OCI_AUTH_MODE must be one of config-file, instance-principal",
      })
      .default("config-file"),
    OCI_CONFIG_FILE: z.string().optional(),
    OCI_CONFIG_PROFILE: z.string().default("DEFAULT"),

    // email-oci
    OCI_COMPARTMENT_ID: z.string().optional(),

    // storage
    OCI_OBJECT_NAMESPACE: z.string().optional(),
    OCI_BUCKET: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER !== "oci") return;
    if (!value.EMAIL_FROM_ADDRESS) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_FROM_ADDRESS"],
        message: "EMAIL_FROM_ADDRESS is required when EMAIL_PROVIDER=oci",
      });
    }
    if (!value.OCI_REGION) {
      ctx.addIssue({
        code: "custom",
        path: ["OCI_REGION"],
        message: "OCI_REGION is required when EMAIL_PROVIDER=oci",
      });
    }
    if (!value.OCI_COMPARTMENT_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["OCI_COMPARTMENT_ID"],
        message: "OCI_COMPARTMENT_ID is required when EMAIL_PROVIDER=oci",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const flattened = z.flattenError(result.error);
    const lines = [
      ...Object.values(flattened.fieldErrors).flat(),
      ...flattened.formErrors,
    ];
    throw new Error(
      `Invalid environment variables:\n  - ${lines.join("\n  - ")}`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv();
