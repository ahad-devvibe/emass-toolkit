import { Prisma } from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getHubspotConfig, type HubspotConfig } from "../../configs/hubspot.js";
import { countryName } from "../../utils/country.utils.js";
import {
  HUBSPOT_USE_CASE_PROPERTY,
  firstDownloadNoteBody,
  toDownloadProperties,
} from "./hubspot.utils.js";

export interface HubspotContactInput {
  email: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  country: string;
  companyName: string;
  jobTitle: string;
  useCase?: string | null;
  website?: string | null;
}

/**
 * One-way sync: the portal only ever creates/updates contacts in HubSpot.
 * Failures are logged and swallowed by the caller — a HubSpot outage must
 * never fail a signup or an account activation.
 */
export interface HubspotClient {
  /** Resolves to the HubSpot contact record ID, or null when none is known. */
  upsertContact(input: HubspotContactInput): Promise<{ id: string } | null>;
  /** Sets properties on an existing contact (by HubSpot record ID). */
  updateContact(
    contactId: string,
    properties: Record<string, string>,
  ): Promise<void>;
  /** Adds a note to the contact's timeline. */
  createNote(contactId: string, body: string, timestamp: Date): Promise<void>;
}

const HUBSPOT_BATCH_UPSERT_URL =
  "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert?archived=false";
const HUBSPOT_CONTACTS_URL = "https://api.hubapi.com/crm/v3/objects/contacts";
const HUBSPOT_NOTES_URL = "https://api.hubapi.com/crm/v3/objects/notes";
// HubSpot-defined association type: note → contact
const NOTE_TO_CONTACT = 202;

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
  if (input.useCase) properties[HUBSPOT_USE_CASE_PROPERTY] = input.useCase;
  // HubSpot's built-in contact property: nothing to set up in the portal
  if (input.website) properties.website = input.website;
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
    async updateContact(contactId, properties) {
      logger.info(
        { contactId, properties },
        "hubspot contact update (disabled, logged only)",
      );
    },
    async createNote(contactId) {
      logger.info({ contactId }, "hubspot note (disabled, logged only)");
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

    async updateContact(contactId, properties) {
      await send(
        `${HUBSPOT_CONTACTS_URL}/${encodeURIComponent(contactId)}`,
        "PATCH",
        { properties },
        "hubspot contact update rejected",
      );
    },

    async createNote(contactId, body, timestamp) {
      await send(
        HUBSPOT_NOTES_URL,
        "POST",
        {
          properties: {
            hs_note_body: body,
            hs_timestamp: timestamp.toISOString(),
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: NOTE_TO_CONTACT,
                },
              ],
            },
          ],
        },
        "hubspot note rejected",
      );
    },
  };

  async function send(
    url: string,
    method: "PATCH" | "POST",
    payload: unknown,
    failure: string,
  ): Promise<void> {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${configFactory().apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 500);
      logger.error({ status: response.status, body }, failure);
      throw new Error(`${failure} with status ${response.status}`);
    }
  }
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
      useCase: user.useCase,
      website: user.website,
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

/**
 * Pushes a customer's stored download totals to their contact, and the
 * first-download note once. Reads one user row; values are set (never
 * incremented) in HubSpot, so a retry can't drift them. Progress is kept on
 * the user (`hubspotSyncedDownloads`, `hubspotNoteSentAt`), which is how the
 * catch-up sweep finds anything a failure left behind. Best effort: errors
 * are logged, never thrown.
 */
export async function syncDownloadsToHubspot(
  userId: string,
  client: HubspotClient = hubspotService,
): Promise<void> {
  try {
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.downloadCount === 0) return;
    // Activation sync may have missed this contact; create it now
    if (!user.hubspotContactId) {
      await syncHubspotContact(user, client);
      user = await prisma.user.findUnique({ where: { id: userId } });
    }
    const contactId = user?.hubspotContactId;
    if (!user || !contactId) return;

    const synced = user.downloadCount;
    await client.updateContact(contactId, toDownloadProperties(user));
    // Never moves backwards if a newer sync already finished
    await prisma.user.updateMany({
      where: { id: userId, hubspotSyncedDownloads: { lt: synced } },
      data: { hubspotSyncedDownloads: synced },
    });

    // Claim the note so concurrent syncs send it once; release on failure
    const claimed = await prisma.user.updateMany({
      where: { id: userId, hubspotNoteSentAt: null },
      data: { hubspotNoteSentAt: new Date() },
    });
    if (claimed.count === 0) return;
    try {
      await client.createNote(
        contactId,
        firstDownloadNoteBody(user.firstDownloadLabel, {
          acceptedAt: user.licenseAcceptedAt,
          version: user.licenseVersion,
        }),
        user.firstDownloadAt ?? new Date(),
      );
    } catch (err) {
      await prisma.user.update({
        where: { id: userId },
        data: { hubspotNoteSentAt: null },
      });
      throw err;
    }
  } catch (err) {
    logger.warn({ err, userId }, "hubspot download sync failed");
  }
}
