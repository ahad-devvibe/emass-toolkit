import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  linkFallback,
  paragraph,
  renderEmailLayout,
} from "./layout.template.js";

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
  const subject = `${input.productName} v${input.version} is available`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `A new version of ${input.productName} is ready to download.`,
      hero: { title: subject },
      reason:
        "You're receiving this because you downloaded this product from the EMASS Portal.",
      body: [
        paragraph(
          `Hi ${firstName}, <strong>${product} v${version}</strong> is ready to download from the EMASS Portal.`,
        ),
        button(url, "View release"),
        linkFallback(url),
      ].join("\n"),
    }),
    text: `Hi ${input.firstName}, ${input.productName} v${input.version} is ready to download from the EMASS Portal:\n\n${input.url}`,
  };
}
