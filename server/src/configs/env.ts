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
      .describe("Frontend origin used to build links in emails"),
    // TODO(auth-otp-signup): unused since OTP signup, remove later
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
    // Prod splits staging and release buckets; both default to OCI_BUCKET
    OCI_STAGING_BUCKET: z.string().optional(),
    OCI_RELEASE_BUCKET: z.string().optional(),
    STORAGE_DRIVER: z
      .enum(["local", "oci"], {
        error: "STORAGE_DRIVER must be one of local, oci",
      })
      .default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default(".tmp/storage"),
    MAX_UPLOAD_BYTES: z.coerce
      .number({ error: "MAX_UPLOAD_BYTES must be a positive integer" })
      .int({ error: "MAX_UPLOAD_BYTES must be a positive integer" })
      .positive({ error: "MAX_UPLOAD_BYTES must be a positive integer" })
      .default(1024 ** 3),
    // Node's server-wide request timeout; uploads of ~1 GiB need far more
    // than the 300 s default (slow clients are nginx's job in production)
    UPLOAD_TIMEOUT_MS: z.coerce
      .number({ error: "UPLOAD_TIMEOUT_MS must be a positive integer" })
      .int({ error: "UPLOAD_TIMEOUT_MS must be a positive integer" })
      .positive({ error: "UPLOAD_TIMEOUT_MS must be a positive integer" })
      .default(2 * 60 * 60 * 1000),
    // Publish copies each file staging → release; OCI runs the copy as a work
    // request we poll. A 1 GiB copy needs well over the old 6 s budget
    COPY_TIMEOUT_MS: z.coerce
      .number({ error: "COPY_TIMEOUT_MS must be a positive integer" })
      .int({ error: "COPY_TIMEOUT_MS must be a positive integer" })
      .positive({ error: "COPY_TIMEOUT_MS must be a positive integer" })
      .default(30 * 60 * 1000),
    COPY_POLL_MS: z.coerce
      .number({ error: "COPY_POLL_MS must be an integer >= 200" })
      .int({ error: "COPY_POLL_MS must be an integer >= 200" })
      .min(200, { error: "COPY_POLL_MS must be an integer >= 200" })
      .default(1000),
    // A finished publish job stays readable this long, so a reopened dialog
    // still sees the result
    PUBLISH_JOB_TTL_MS: z.coerce
      .number({ error: "PUBLISH_JOB_TTL_MS must be a positive integer" })
      .int({ error: "PUBLISH_JOB_TTL_MS must be a positive integer" })
      .positive({ error: "PUBLISH_JOB_TTL_MS must be a positive integer" })
      .default(10 * 60 * 1000),
    // OCI multipart parts must be at least 10 MiB (except the last one)
    UPLOAD_PART_BYTES: z.coerce
      .number({ error: "UPLOAD_PART_BYTES must be an integer >= 10485760" })
      .int({ error: "UPLOAD_PART_BYTES must be an integer >= 10485760" })
      .min(10 * 1024 ** 2, {
        error: "UPLOAD_PART_BYTES must be an integer >= 10485760",
      })
      .default(10 * 1024 ** 2),

    // hubspot (one-way customer contact sync)
    HUBSPOT_ENABLED: z
      .enum(["true", "false"], {
        error: "HUBSPOT_ENABLED must be true or false",
      })
      .default("false"),
    HUBSPOT_API_KEY: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // The local driver writes to the VM disk; production must use OCI
    if (value.NODE_ENV === "production" && value.STORAGE_DRIVER !== "oci") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "STORAGE_DRIVER must be oci in production",
      });
    }
    if (value.HUBSPOT_ENABLED === "true" && !value.HUBSPOT_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["HUBSPOT_API_KEY"],
        message: "HUBSPOT_API_KEY is required when HUBSPOT_ENABLED=true",
      });
    }
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
