// Definition of the custom HubSpot contact property that carries the portal
// account status. Shared by the sync (hubspot.service.ts) and the one-off
// setup script (scripts/setup-hubspot.ts) so both agree on name and options.

export const HUBSPOT_PORTAL_STATUS_PROPERTY = "emass_portal_status";

export const PORTAL_STATUS_OPTIONS = [
  { value: "pending_password", label: "Pending password" },
  { value: "active", label: "Active" },
] as const;

/**
 *   pending_password — approved or company-domain account, no password yet
 *   active           — password set, account usable
 */
export type HubspotPortalStatus =
  (typeof PORTAL_STATUS_OPTIONS)[number]["value"];

export interface HubspotPropertyOption {
  label: string;
  value: string;
  displayOrder: number;
  hidden?: boolean;
}

export const PORTAL_STATUS_PROPERTY = {
  name: HUBSPOT_PORTAL_STATUS_PROPERTY,
  label: "EMASS Portal Status",
  description:
    "Set by the EMASS Toolkit portal. Pending password: approved but no password yet. Active: account in use.",
  groupName: "contactinformation",
  type: "enumeration",
  fieldType: "select",
  options: PORTAL_STATUS_OPTIONS.map(
    (option, index): HubspotPropertyOption => ({
      ...option,
      displayOrder: index,
      hidden: false,
    }),
  ),
};

/** Existing options plus any of ours that are missing; never drops an option. */
export function mergePropertyOptions(
  existing: HubspotPropertyOption[],
  wanted: HubspotPropertyOption[] = PORTAL_STATUS_PROPERTY.options,
): { options: HubspotPropertyOption[]; added: string[] } {
  const have = new Set(existing.map((option) => option.value));
  const missing = wanted.filter((option) => !have.has(option.value));
  return {
    options: [
      ...existing,
      ...missing.map((option, index) => ({
        ...option,
        displayOrder: existing.length + index,
      })),
    ],
    added: missing.map((option) => option.value),
  };
}
