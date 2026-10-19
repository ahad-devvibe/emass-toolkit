import { ObjectStorageClient } from "oci-objectstorage";
import {
  ConfigFileAuthenticationDetailsProvider,
  InstancePrincipalsAuthenticationDetailsProviderBuilder,
} from "oci-common";
import type { AuthenticationDetailsProvider } from "oci-common";
import { ApiError } from "../utils/api-error.utils.js";
import { env } from "./env.js";

export type StorageAuthMode = "config-file" | "instance-principal";

export interface StorageConfig {
  region: string;
  namespace: string;
  bucket: string;
  authMode: StorageAuthMode;
  configFile?: string;
  configProfile?: string;
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new ApiError(
      500,
      `Object storage configuration is missing: ${name}`,
      "STORAGE_CONFIG_MISSING",
    );
  }
  return value;
}

export function getStorageConfig(): StorageConfig {
  return {
    region: requiredEnv(env.OCI_REGION, "OCI_REGION"),
    namespace: requiredEnv(env.OCI_OBJECT_NAMESPACE, "OCI_OBJECT_NAMESPACE"),
    bucket: requiredEnv(env.OCI_BUCKET, "OCI_BUCKET"),
    authMode: env.OCI_AUTH_MODE,
    configFile: env.OCI_CONFIG_FILE?.trim() || undefined,
    configProfile: env.OCI_CONFIG_PROFILE || "DEFAULT",
  };
}

export type ObjectStorageClientLike = Pick<
  ObjectStorageClient,
  | "putObject"
  | "headObject"
  | "deleteObject"
  | "copyObject"
  | "getWorkRequest"
  | "createPreauthenticatedRequest"
>;

type ClientFactory = (
  config: StorageConfig,
) => Promise<ObjectStorageClientLike>;

async function createObjectStorageClient(
  config: StorageConfig,
): Promise<ObjectStorageClientLike> {
  let authenticationDetailsProvider: AuthenticationDetailsProvider;

  if (config.authMode === "instance-principal") {
    authenticationDetailsProvider =
      await new InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  } else {
    authenticationDetailsProvider = new ConfigFileAuthenticationDetailsProvider(
      config.configFile,
      config.configProfile,
    );
  }

  const client = new ObjectStorageClient({ authenticationDetailsProvider });
  client.regionId = config.region;
  return client;
}

export function createStorageClientFactory(
  factory: ClientFactory = createObjectStorageClient,
): () => Promise<ObjectStorageClientLike> {
  let clientPromise: Promise<ObjectStorageClientLike> | undefined;

  return () => {
    clientPromise ??= factory(getStorageConfig());
    return clientPromise;
  };
}

export const getStorageClient = createStorageClientFactory();
