import { Prisma } from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getHubspotConfig, type HubspotConfig } from "../../configs/hubspot.js";
import { countryName } from "../../utils/country.utils.js";

export interface HubspotContactInput {
  email: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  country: string;
  companyName: string;
  jobTitle: string;
}

/**
 * One-way sync: the portal only ever creates/updates contacts in HubSpot.
 * Failures are logged and swallowed by the caller — a HubSpot outage must
 * never fail a signup or an account activation.
 */
export interface HubspotClient {
  /** Resolves to the HubSpot contact record ID, or null when none is known. */
  upsertContact(input: HubspotContactInput): Promise<{ id: string } | null>;
}

const HUBSPOT_BATCH_UPSERT_URL =
  "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert?archived=false";

function toContactProperties(
  input: HubspotContactInput,
): Record<string, string> {
  const properties: Record<string, string> = {
    email: input.email,
    firstname: input.firstName,
    lastname: input.lastName,
    // We store the ISO code; HubSpot shows the readable name
    country: countryName(input.country),
    company: input.companyName,
    jobtitle: input.jobTitle,
    // Contacts are only created once the portal account is active (verified
    // email, password set, approved if needed); sales qualifies them from here
    lifecyclestage: "lead",
  };
  if (input.middleName) properties.middlename = input.middleName;
  return properties;
}

export function createLogHubspotClient(): HubspotClient {
  return {
    async upsertContact(input) {
      logger.info(
        { email: input.email },
        "hubspot contact (disabled, logged only)",
      );
      return null;
    },
  };
}

export function createApiHubspotClient(
  configFactory: () => HubspotConfig = getHubspotConfig,
  fetchImpl: typeof fetch = fetch,
): HubspotClient {
  return {
    async upsertContact(input) {
      const config = configFactory();
      const response = await fetchImpl(HUBSPOT_BATCH_UPSERT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [
            {
              idProperty: "email",
              id: input.email,
              properties: toContactProperties(input),
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 500);
        logger.error(
          { email: input.email, status: response.status, body },
          "hubspot contact upsert rejected",
        );
        throw new Error(`hubspot upsert failed with status ${response.status}`);
      }

      // Batch upsert can return 2xx while carrying per-input validation
      // errors in the body — never report success when HubSpot dropped data.
      const body = (await response.json().catch(() => null)) as {
        errors?: unknown[];
        results?: { id?: string | number; errors?: unknown[] }[];
      } | null;
      const inputErrors = [
        ...(body?.errors ?? []),
        ...(body?.results ?? []).flatMap((r) => r?.errors ?? []),
      ];
      if (inputErrors.length > 0) {
        logger.error(
          { email: input.email, errors: inputErrors.slice(0, 5) },
          "hubspot contact upsert reported errors",
        );
        throw new Error("hubspot upsert reported per-input errors");
      }

      const id = body?.results?.[0]?.id;
      if (id === undefined || id === null || id === "") {
        logger.warn(
          { email: input.email },
          "hubspot upsert succeeded without a record id",
        );
        return null;
      }
      logger.info({ email: input.email, id }, "hubspot contact upserted");
      return { id: String(id) };
    },
  };
}

export function createHubspotClient(): HubspotClient {
  return getHubspotConfig().enabled
    ? createApiHubspotClient()
    : createLogHubspotClient();
}

export const hubspotService: HubspotClient = createHubspotClient();

export type HubspotContactSource = HubspotContactInput & {
  /** Our user id, used to store the HubSpot record ID back on the row. */
  id: string;
};

/**
 * Best-effort sync, called once an account becomes ACTIVE (company signup
 * completed, or a free-mail signup approved): a HubSpot outage is logged and
 * never fails the caller. Upserts are keyed by email, so the
 * next transition repairs a contact missed during an outage. The returned
 * HubSpot record ID is stored on the user (`hubspotContactId`) for later
 * events and reconciliation.
 */
export async function syncHubspotContact(
  user: HubspotContactSource,
  client: HubspotClient = hubspotService,
): Promise<void> {
  let contact: { id: string } | null;
  try {
    contact = await client.upsertContact({
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      country: user.country,
      companyName: user.companyName,
      jobTitle: user.jobTitle,
    });
  } catch (err) {
    logger.warn({ err, userId: user.id }, "hubspot contact sync failed");
    return;
  }
  if (!contact) return;

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { hubspotContactId: contact.id, hubspotSyncedAt: new Date() },
    });
  } catch (err) {
    // Another user already holds this HubSpot record: two portal accounts map
    // to one contact. Leave both rows alone for a human to sort out.
    const conflict =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002";
    logger.warn(
      { err, userId: user.id, hubspotContactId: contact.id },
      conflict
        ? "hubspot contact id already linked to another user; not stored"
        : "hubspot contact id not stored",
    );
  }
}
