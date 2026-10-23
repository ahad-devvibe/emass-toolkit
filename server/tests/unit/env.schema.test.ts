import { describe, expect, it } from "vitest";
import { envSchema, parseEnv } from "../../src/configs/env.js";

const base = {
  DATABASE_URL: "postgresql://localhost/starterkit",
  JWT_SECRET: "test-secret",
};

describe("envSchema", () => {
  it("applies defaults when only DATABASE_URL and JWT_SECRET are set", () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(5000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBe("postgresql://localhost/starterkit");
    expect(env.EMAIL_PROVIDER).toBe("console");
    expect(env.OCI_AUTH_MODE).toBe("config-file");
    expect(env.OCI_CONFIG_PROFILE).toBe("DEFAULT");
  });

  it("coerces PORT from string to number", () => {
    const env = parseEnv({ ...base, PORT: "4000" });
    expect(env.PORT).toBe(4000);
  });

  it("fails with a required message when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ JWT_SECRET: "x" })).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("fails when DATABASE_URL is empty", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "" })).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("fails when JWT_SECRET is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      "JWT_SECRET is required",
    );
  });

  it("fails when JWT_SECRET is empty", () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: "" })).toThrow(
      "JWT_SECRET is required",
    );
  });

  it("fails when PORT is not a number", () => {
    expect(() => parseEnv({ ...base, PORT: "not-a-port" })).toThrow(
      "PORT must be a number",
    );
  });

  it("fails when PORT is out of range", () => {
    expect(() => parseEnv({ ...base, PORT: "70000" })).toThrow(
      "PORT must be a number between 1 and 65535",
    );
  });

  it("fails when NODE_ENV is invalid", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "staging" })).toThrow(
      "NODE_ENV must be one of development, test, production",
    );
  });

  it("fails when LOG_LEVEL is invalid", () => {
    expect(() => parseEnv({ ...base, LOG_LEVEL: "verbose" })).toThrow(
      "LOG_LEVEL must be one of",
    );
  });

  it("fails when EMAIL_PROVIDER is invalid", () => {
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: "smtp" })).toThrow(
      "EMAIL_PROVIDER must be one of console, oci",
    );
  });

  it("keeps OCI cloud keys optional at boot for console mode", () => {
    const env = parseEnv(base);
    expect(env.EMAIL_FROM_ADDRESS).toBeUndefined();
    expect(env.OCI_REGION).toBeUndefined();
    expect(env.OCI_COMPARTMENT_ID).toBeUndefined();
    expect(env.OCI_OBJECT_NAMESPACE).toBeUndefined();
    expect(env.OCI_BUCKET).toBeUndefined();
  });

  it("requires EMAIL_FROM_ADDRESS when EMAIL_PROVIDER=oci", () => {
    expect(() =>
      parseEnv({
        ...base,
        EMAIL_PROVIDER: "oci",
        OCI_REGION: "us-phoenix-1",
        OCI_COMPARTMENT_ID: "c1",
      }),
    ).toThrow("EMAIL_FROM_ADDRESS is required when EMAIL_PROVIDER=oci");
  });

  it("requires OCI_REGION when EMAIL_PROVIDER=oci", () => {
    expect(() =>
      parseEnv({
        ...base,
        EMAIL_PROVIDER: "oci",
        EMAIL_FROM_ADDRESS: "a@b.com",
        OCI_COMPARTMENT_ID: "c1",
      }),
    ).toThrow("OCI_REGION is required when EMAIL_PROVIDER=oci");
  });

  it("requires OCI_COMPARTMENT_ID when EMAIL_PROVIDER=oci", () => {
    expect(() =>
      parseEnv({
        ...base,
        EMAIL_PROVIDER: "oci",
        EMAIL_FROM_ADDRESS: "a@b.com",
        OCI_REGION: "us-phoenix-1",
      }),
    ).toThrow("OCI_COMPARTMENT_ID is required when EMAIL_PROVIDER=oci");
  });

  it("accepts a fully configured oci provider", () => {
    const env = parseEnv({
      ...base,
      EMAIL_PROVIDER: "oci",
      EMAIL_FROM_ADDRESS: "no-reply@example.com",
      OCI_REGION: "us-phoenix-1",
      OCI_COMPARTMENT_ID: "ocid1.compartment.example",
    });
    expect(env.EMAIL_PROVIDER).toBe("oci");
  });

  it("aggregates every issue into one error", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "staging", LOG_LEVEL: "verbose" }),
    ).toThrow(
      /Invalid environment variables:[\s\S]*DATABASE_URL is required[\s\S]*LOG_LEVEL must be one of[\s\S]*JWT_SECRET is required/,
    );
  });

  it("exposes a parseable schema object", () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("defaults the signup/set-password keys", () => {
    const env = parseEnv(base);
    expect(env.APP_BASE_URL).toBe("http://localhost:5173");
    expect(env.SET_PASSWORD_TTL_HOURS).toBe(48);
    expect(env.SET_PASSWORD_REMINDER_HOURS).toBe(24);
    expect(env.CAPTCHA_TTL_SECONDS).toBe(600);
  });

  it("coerces the numeric signup keys from strings", () => {
    const env = parseEnv({
      ...base,
      SET_PASSWORD_TTL_HOURS: "72",
      CAPTCHA_TTL_SECONDS: "300",
    });
    expect(env.SET_PASSWORD_TTL_HOURS).toBe(72);
    expect(env.CAPTCHA_TTL_SECONDS).toBe(300);
  });

  it("rejects non-positive TTL values", () => {
    expect(() => parseEnv({ ...base, SET_PASSWORD_TTL_HOURS: "0" })).toThrow();
    expect(() => parseEnv({ ...base, CAPTCHA_TTL_SECONDS: "-1" })).toThrow();
  });

  it("keeps HubSpot disabled by default without an API key", () => {
    const env = parseEnv(base);
    expect(env.HUBSPOT_ENABLED).toBe("false");
    expect(env.HUBSPOT_API_KEY).toBeUndefined();
  });

  it("requires HUBSPOT_API_KEY when HUBSPOT_ENABLED=true", () => {
    expect(() => parseEnv({ ...base, HUBSPOT_ENABLED: "true" })).toThrow(
      "HUBSPOT_API_KEY is required when HUBSPOT_ENABLED=true",
    );
  });

  it("accepts a fully configured HubSpot", () => {
    const env = parseEnv({
      ...base,
      HUBSPOT_ENABLED: "true",
      HUBSPOT_API_KEY: "pat-x",
    });
    expect(env.HUBSPOT_ENABLED).toBe("true");
    expect(env.HUBSPOT_API_KEY).toBe("pat-x");
  });

  it("rejects an invalid HUBSPOT_ENABLED value", () => {
    expect(() => parseEnv({ ...base, HUBSPOT_ENABLED: "yes" })).toThrow(
      "HUBSPOT_ENABLED must be true or false",
    );
  });

  it("defaults storage to the local driver with a 1 GiB cap and 10 MiB parts", () => {
    const env = parseEnv(base);
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.STORAGE_LOCAL_DIR).toBe(".tmp/storage");
    expect(env.MAX_UPLOAD_BYTES).toBe(1024 ** 3);
    expect(env.UPLOAD_PART_BYTES).toBe(10 * 1024 ** 2);
  });

  it("requires the oci storage driver in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(
      "STORAGE_DRIVER must be oci in production",
    );
    const env = parseEnv({
      ...base,
      NODE_ENV: "production",
      STORAGE_DRIVER: "oci",
    });
    expect(env.STORAGE_DRIVER).toBe("oci");
  });

  it("rejects an invalid STORAGE_DRIVER", () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(
      "STORAGE_DRIVER must be one of local, oci",
    );
  });

  it("rejects upload parts below the OCI 10 MiB minimum", () => {
    expect(() => parseEnv({ ...base, UPLOAD_PART_BYTES: "1024" })).toThrow(
      "UPLOAD_PART_BYTES must be an integer >= 10485760",
    );
  });

  it("defaults the publish copy timeout and poll interval", () => {
    const env = parseEnv(base);
    expect(env.COPY_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(env.COPY_POLL_MS).toBe(1000);
  });

  it("validates the copy settings", () => {
    expect(() => parseEnv({ ...base, COPY_TIMEOUT_MS: "0" })).toThrow(
      "COPY_TIMEOUT_MS must be a positive integer",
    );
    expect(() => parseEnv({ ...base, COPY_POLL_MS: "50" })).toThrow(
      "COPY_POLL_MS must be an integer >= 200",
    );
  });

  it("rejects a non-positive MAX_UPLOAD_BYTES", () => {
    expect(() => parseEnv({ ...base, MAX_UPLOAD_BYTES: "0" })).toThrow(
      "MAX_UPLOAD_BYTES must be a positive integer",
    );
  });
});
