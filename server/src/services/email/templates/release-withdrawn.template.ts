import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  callout,
  heading,
  linkFallback,
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
    ? `Please download <strong>v${replacement}</strong> instead.`
    : "We'll let you know when a new version is available.";
  const nextText = input.replacementVersion
    ? `Please download v${input.replacementVersion} instead.`
    : "We'll let you know when a new version is available.";
  const action = replacement ? `Get v${replacement}` : "Open the EMASS portal";

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `${input.productName} v${input.withdrawnVersion} is no longer available. ${nextText}`,
      eyebrow: "Release update",
      hero: {
        title: `${product} v${withdrawn} has been withdrawn`,
        subtitle: "Please stop using this version.",
      },
      reason:
        "You're receiving this because you downloaded this release from the EMASS portal.",
      body: [
        heading(`Hi ${firstName},`),
        paragraph(
          `You downloaded <strong>${product} v${withdrawn}</strong> from the EMASS portal. We've withdrawn this version, so please stop using it. ${next}`,
        ),
        ...(message
          ? [
              callout(
                `<strong>A note from the EMASS team:</strong><br>${escapeHtml(message)}`,
              ),
            ]
          : []),
        button(url, action),
        linkFallback(url),
      ].join("\n"),
    }),
    text: [
      `Hi ${input.firstName},`,
      "",
      `You downloaded ${input.productName} v${input.withdrawnVersion} from the EMASS portal. We've withdrawn this version, so please stop using it. ${nextText}`,
      ...(message ? ["", `A note from the EMASS team: ${message}`] : []),
      "",
      `${input.replacementVersion ? `Get v${input.replacementVersion}` : "Open the EMASS portal"}: ${input.url}`,
    ].join("\n"),
  };
}
