import { ApiError } from "../utils/api-error.utils.js";
import { env } from "./env.js";

export type EmailAuthMode = "config-file" | "instance-principal";
export type EmailProvider = "console" | "oci";

export interface EmailConfig {
  provider: EmailProvider;
  fromAddress: string;
  fromName: string;
  region: string;
  compartmentId: string;
  authMode: EmailAuthMode;
  configFile?: string;
  configProfile?: string;
}

export function getEmailProvider(): EmailProvider {
  return env.EMAIL_PROVIDER;
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new ApiError(
      500,
      `Email configuration is missing: ${name}`,
      "EMAIL_CONFIG_MISSING",
    );
  }
  return value;
}

export function getEmailConfig(): EmailConfig {
  const provider = env.EMAIL_PROVIDER;
  if (provider !== "oci") {
    throw new ApiError(
      500,
      "OCI email configuration is not used when EMAIL_PROVIDER=console",
      "EMAIL_CONFIG_INVALID",
    );
  }

  return {
    provider: "oci",
    fromAddress: requiredEnv(env.EMAIL_FROM_ADDRESS, "EMAIL_FROM_ADDRESS"),
    fromName: env.EMAIL_FROM_NAME?.trim() || "EMASS Toolkit",
    region: requiredEnv(env.OCI_REGION, "OCI_REGION"),
    compartmentId: requiredEnv(env.OCI_COMPARTMENT_ID, "OCI_COMPARTMENT_ID"),
    authMode: env.OCI_AUTH_MODE,
    configFile: env.OCI_CONFIG_FILE?.trim() || undefined,
    configProfile: env.OCI_CONFIG_PROFILE || "DEFAULT",
  };
}
