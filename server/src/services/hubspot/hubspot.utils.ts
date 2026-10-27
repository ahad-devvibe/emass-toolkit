// HubSpot contact properties the portal writes (one-way), shared by the sync,
// the setup script (scripts/setup-hubspot.ts) and the Settings check.

// Free-text contact property for what the person said they'll use EMASS for
export const HUBSPOT_USE_CASE_PROPERTY = "emass_use_case";

export const USE_CASE_PROPERTY = {
  name: HUBSPOT_USE_CASE_PROPERTY,
  label: "EMASS use case",
  description:
    "Set by the EMASS Toolkit portal: what the person said at sign-up they will use EMASS for.",
  groupName: "contactinformation",
  type: "string",
  fieldType: "textarea",
};

export type HubspotConnectionState = "connected" | "off" | "problem";

export interface HubspotConnectionStatus {
  state: HubspotConnectionState;
  /** Plain-language sentence for admins; no setting names or codes. */
  message: string;
}

const ASK_TECH = "Ask your technical contact to";

/**
 * What a check of HubSpot means for an admin. `httpStatus` is HubSpot's
 * answer to reading our use-case property, or null when it couldn't be
 * reached at all.
 */
export function describeHubspotCheck(
  httpStatus: number | null,
): HubspotConnectionStatus {
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    return {
      state: "connected",
      message:
        "Connected. New customers are added to HubSpot when their account is activated.",
    };
  }
  const problem = (message: string): HubspotConnectionStatus => ({
    state: "problem",
    message,
  });
  if (httpStatus === 401) {
    return problem(
      `HubSpot rejected the connection. The access key may have expired or been revoked. ${ASK_TECH} renew it.`,
    );
  }
  if (httpStatus === 403) {
    return problem(
      `HubSpot is connected but doesn't allow everything the portal needs. ${ASK_TECH} update the HubSpot app's permissions.`,
    );
  }
  if (httpStatus === 404) {
    return problem(
      `HubSpot is connected but isn't fully set up for the portal yet. ${ASK_TECH} finish the setup.`,
    );
  }
  if (httpStatus === 429) {
    return problem("HubSpot is busy right now. Try again in a minute.");
  }
  return problem(
    "We couldn't reach HubSpot. It may be having problems; try again in a few minutes.",
  );
}

// --- Download tracking (customers only, one-way) ---

export const HUBSPOT_DOWNLOAD_COUNT_PROPERTY = "emass_download_count";
export const HUBSPOT_FIRST_DOWNLOAD_AT_PROPERTY = "emass_first_download_at";
export const HUBSPOT_LAST_DOWNLOAD_AT_PROPERTY = "emass_last_download_at";
export const HUBSPOT_LAST_DOWNLOAD_PROPERTY = "emass_last_download";
export const HUBSPOT_FIRST_DOWNLOAD_PROPERTY = "emass_first_download";

/** A contact property with no options (text, number, date). */
export interface SimplePropertyDefinition {
  name: string;
  label: string;
  description: string;
  groupName: string;
  type: string;
  fieldType: string;
}

const portalProperty = (
  name: string,
  label: string,
  description: string,
  type: string,
  fieldType: string,
): SimplePropertyDefinition => ({
  name,
  label,
  description: `Set by the EMASS Toolkit portal: ${description}`,
  groupName: "contactinformation",
  type,
  fieldType,
});

export const DOWNLOAD_PROPERTIES: SimplePropertyDefinition[] = [
  portalProperty(
    HUBSPOT_DOWNLOAD_COUNT_PROPERTY,
    "EMASS download count",
    "how many files this person has downloaded.",
    "number",
    "number",
  ),
  portalProperty(
    HUBSPOT_FIRST_DOWNLOAD_AT_PROPERTY,
    "EMASS first download",
    "when this person first downloaded a file.",
    "datetime",
    "date",
  ),
  portalProperty(
    HUBSPOT_LAST_DOWNLOAD_AT_PROPERTY,
    "EMASS last download",
    "when this person last downloaded a file.",
    "datetime",
    "date",
  ),
  portalProperty(
    HUBSPOT_FIRST_DOWNLOAD_PROPERTY,
    "EMASS first downloaded file",
    "the product, version and file of the first download.",
    "string",
    "text",
  ),
  portalProperty(
    HUBSPOT_LAST_DOWNLOAD_PROPERTY,
    "EMASS last downloaded file",
    "the product, version and file of the latest download.",
    "string",
    "text",
  ),
];

/** Every contact property the portal writes; the Settings check looks for all of them. */
export const PORTAL_PROPERTY_NAMES = [
  HUBSPOT_USE_CASE_PROPERTY,
  ...DOWNLOAD_PROPERTIES.map((property) => property.name),
];

export interface DownloadedFileLabel {
  productName: string;
  version: string;
  fileName: string;
}

/** The download totals kept on User, in step with Download rows (downloads.service). */
export interface DownloadCounters {
  downloadCount: number;
  firstDownloadAt: Date | null;
  firstDownloadLabel: string | null;
  lastDownloadAt: Date | null;
  lastDownloadLabel: string | null;
}

export const downloadLabel = ({
  productName,
  version,
  fileName,
}: DownloadedFileLabel) => `${productName} v${version}: ${fileName}`;

/**
 * The contact's download fields, straight from the stored counters. HubSpot
 * values are always set from our totals, never incremented there, so a
 * failed or repeated sync can't drift the count.
 */
export function toDownloadProperties(
  counters: DownloadCounters,
): Record<string, string> {
  const properties: Record<string, string> = {
    [HUBSPOT_DOWNLOAD_COUNT_PROPERTY]: String(counters.downloadCount),
  };
  if (counters.firstDownloadAt) {
    properties[HUBSPOT_FIRST_DOWNLOAD_AT_PROPERTY] =
      counters.firstDownloadAt.toISOString();
  }
  if (counters.lastDownloadAt) {
    properties[HUBSPOT_LAST_DOWNLOAD_AT_PROPERTY] =
      counters.lastDownloadAt.toISOString();
  }
  if (counters.firstDownloadLabel) {
    properties[HUBSPOT_FIRST_DOWNLOAD_PROPERTY] = counters.firstDownloadLabel;
  }
  if (counters.lastDownloadLabel) {
    properties[HUBSPOT_LAST_DOWNLOAD_PROPERTY] = counters.lastDownloadLabel;
  }
  return properties;
}

const noteDate = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** The note sales sees on the contact for the first download, whenever it's sent. */
export function firstDownloadNoteBody(
  firstLabel: string | null,
  license: { acceptedAt: Date | null; version: string | null },
): string {
  const accepted =
    license.acceptedAt && license.version
      ? ` Accepted the EMASS Software Licence (${license.version}) on ${noteDate(license.acceptedAt)}.`
      : "";
  const file = firstLabel ? `: ${firstLabel}` : "";
  return `First download from the EMASS portal${file}.${accepted}`;
}
