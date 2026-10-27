import {
  USE_CASE_PROPERTY,
  type SimplePropertyDefinition,
} from "./hubspot.utils.js";

const PROPERTIES_URL = "https://api.hubapi.com/crm/v3/properties/contacts";

// `changes` names what a PATCH touches, e.g. ["label", "options: active"]
export type PropertySetupResult =
  | { action: "created" }
  | { action: "updated"; changes: string[] }
  | { action: "unchanged" }
  | { action: "would-create" }
  | { action: "would-update"; changes: string[] };

export interface PropertySetupOptions {
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
 * Idempotently creates a contact property without options (text, number,
 * date), or brings its label and description in line. Never changes the type.
 */
export async function ensureSimpleProperty(
  definition: SimplePropertyDefinition,
  { apiKey, dryRun = false, fetchImpl = fetch }: PropertySetupOptions,
): Promise<PropertySetupResult> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const propertyUrl = `${PROPERTIES_URL}/${definition.name}`;

  const current = await fetchImpl(propertyUrl, { headers });
  if (current.status === 404) {
    if (dryRun) return { action: "would-create" };
    const created = await fetchImpl(PROPERTIES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(definition),
    });
    if (!created.ok) throw await failure(created, "property create");
    return { action: "created" };
  }
  if (!current.ok) throw await failure(current, "property lookup");

  const existing = (await current.json()) as {
    label?: string;
    description?: string;
  };
  const patch: { label?: string; description?: string } = {};
  const changes: string[] = [];
  if (existing.label !== definition.label) {
    patch.label = definition.label;
    changes.push("label");
  }
  if (existing.description !== definition.description) {
    patch.description = definition.description;
    changes.push("description");
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

/** The free-text `emass_use_case` property (sign-up answer). */
export const ensureUseCaseProperty = (options: PropertySetupOptions) =>
  ensureSimpleProperty(USE_CASE_PROPERTY, options);
