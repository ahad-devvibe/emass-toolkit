import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  callout,
  paragraph,
  renderEmailLayout,
} from "./layout.template.js";

export interface ReleaseWithdrawnEmailTemplateInput {
  firstName: string;
  productName: string;
  /** The rolled-back version the person downloaded. */
  withdrawnVersion: string;
  /** What to use instead (restored or current published); null when there is none. */
  replacementVersion: string | null;
  /** Absolute URL of the product page (or the catalog when there's no replacement). */
  url: string;
  /** Optional note from the admin, written for customers. Never the internal reason. */
  customerMessage?: string;
}

/** Sent to everyone who downloaded a release that was rolled back. */
export function renderReleaseWithdrawnEmail(
  input: ReleaseWithdrawnEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const product = escapeHtml(input.productName);
  const withdrawn = escapeHtml(input.withdrawnVersion);
  const replacement = input.replacementVersion
    ? escapeHtml(input.replacementVersion)
    : null;
  const url = escapeHtml(input.url);
  const message = input.customerMessage?.trim();
  const subject = `${input.productName} v${input.withdrawnVersion} has been withdrawn`;

  const next = replacement
    ? `Please stop using it and download <strong>v${replacement}</strong> instead.`
    : "Please stop using it. We'll let you know when a new version is available.";
  const nextText = input.replacementVersion
    ? `Please stop using it and download v${input.replacementVersion} instead.`
    : "Please stop using it. We'll let you know when a new version is available.";
  const action = replacement ? `Get v${replacement}` : "Open the EMASS portal";

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `${input.productName} v${input.withdrawnVersion} is no longer available. ${nextText}`,
      hero: { title: subject },
      reason:
        "You're receiving this because you downloaded this release from the EMASS Portal.",
      body: [
        paragraph(
          `Hi ${firstName}, we've withdrawn <strong>${product} v${withdrawn}</strong>, which you downloaded. ${next}`,
        ),
        ...(message
          ? [callout("A note from the EMASS team", escapeHtml(message))]
          : []),
        button(url, action),
      ].join("\n"),
    }),
    text: [
      `Hi ${input.firstName}, we've withdrawn ${input.productName} v${input.withdrawnVersion}, which you downloaded. ${nextText}`,
      ...(message ? ["", `A note from the EMASS team: ${message}`] : []),
      "",
      `${input.replacementVersion ? `Get v${input.replacementVersion}` : "Open the EMASS portal"}: ${input.url}`,
    ].join("\n"),
  };
}
