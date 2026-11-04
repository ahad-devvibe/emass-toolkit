import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import { button, paragraph, renderEmailLayout } from "./layout.template.js";

export interface ReleaseAnnouncedEmailTemplateInput {
  firstName: string;
  productName: string;
  /** The version just published. */
  version: string;
  /** Absolute URL of the product page. */
  url: string;
}

/** Sent to everyone who downloaded any release of the product, when a new one ships. */
export function renderReleaseAnnouncedEmail(
  input: ReleaseAnnouncedEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const product = escapeHtml(input.productName);
  const version = escapeHtml(input.version);
  const url = escapeHtml(input.url);
  const subject = `${input.productName} v${input.version} is now available`;
  const action = `Download v${version}`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `We've released a new version of ${input.productName}.`,
      hero: { title: subject },
      reason:
        "You're receiving this because you downloaded this product from the EMASS Portal.",
      body: [
        paragraph(
          `Hi ${firstName}, we've released a new version of <strong>${product}</strong>. Version <strong>${version}</strong> is now available to download from the EMASS Portal.`,
        ),
        button(url, action),
      ].join("\n"),
    }),
    text: [
      `Hi ${input.firstName}, we've released a new version of ${input.productName}. Version ${input.version} is now available to download from the EMASS Portal.`,
      "",
      `Download v${input.version}: ${input.url}`,
    ].join("\n"),
  };
}
