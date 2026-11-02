export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Whether a failed send is worth retrying, from the provider's HTTP status:
 * throttling (429), server errors (5xx) and no status at all (network,
 * timeout) are; any other 4xx (bad address, bad request) never will be.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

export interface SendFailureDetails {
  retryable: boolean;
  providerStatus?: number;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
