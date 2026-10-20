import {
  HUBSPOT_PORTAL_STATUS_PROPERTY,
  PORTAL_STATUS_PROPERTY,
  mergePropertyOptions,
  type HubspotPropertyOption,
} from "./hubspot.utils.js";

const PROPERTIES_URL = "https://api.hubapi.com/crm/v3/properties/contacts";

// `changes` names what a PATCH touches, e.g. ["label", "options: active"]
export type PortalStatusSetupResult =
  | { action: "created" }
  | { action: "updated"; changes: string[] }
  | { action: "unchanged" }
  | { action: "would-create" }
  | { action: "would-update"; changes: string[] };

export interface PortalStatusSetupOptions {
  apiKey: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

async function failure(response: Response, doing: string): Promise<Error> {
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const hint =
    response.status === 401
      ? " (invalid or expired private-app token)"
      : response.status === 403
        ? " (token is missing scope crm.schemas.contacts.write)"
        : "";
  return new Error(
    `HubSpot ${doing} failed with status ${response.status}${hint}${body ? `: ${body}` : ""}`,
  );
}

/**
 * Idempotently creates the `emass_portal_status` contact property, or brings
 * an existing one in line with the shared definition: label, description and
 * any missing options, in a single PATCH. Never removes options or changes the
 * property type. Needs a private-app token with crm.schemas.contacts.write.
 */
export async function ensurePortalStatusProperty({
  apiKey,
  dryRun = false,
  fetchImpl = fetch,
}: PortalStatusSetupOptions): Promise<PortalStatusSetupResult> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const propertyUrl = `${PROPERTIES_URL}/${HUBSPOT_PORTAL_STATUS_PROPERTY}`;

  const current = await fetchImpl(propertyUrl, { headers });

  if (current.status === 404) {
    if (dryRun) return { action: "would-create" };
    const created = await fetchImpl(PROPERTIES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(PORTAL_STATUS_PROPERTY),
    });
    if (!created.ok) throw await failure(created, "property create");
    return { action: "created" };
  }
  if (!current.ok) throw await failure(current, "property lookup");

  const existing = (await current.json()) as {
    label?: string;
    description?: string;
    options?: HubspotPropertyOption[];
  };

  // Only send what differs, so a re-run with nothing to do never writes
  const patch: {
    label?: string;
    description?: string;
    options?: HubspotPropertyOption[];
  } = {};
  const changes: string[] = [];
  if (existing.label !== PORTAL_STATUS_PROPERTY.label) {
    patch.label = PORTAL_STATUS_PROPERTY.label;
    changes.push("label");
  }
  if (existing.description !== PORTAL_STATUS_PROPERTY.description) {
    patch.description = PORTAL_STATUS_PROPERTY.description;
    changes.push("description");
  }
  const { options, added } = mergePropertyOptions(existing.options ?? []);
  if (added.length > 0) {
    patch.options = options;
    changes.push(`options: ${added.join(", ")}`);
  }

  if (changes.length === 0) return { action: "unchanged" };
  if (dryRun) return { action: "would-update", changes };

  const updated = await fetchImpl(propertyUrl, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (!updated.ok) throw await failure(updated, "property update");
  return { action: "updated", changes };
}
