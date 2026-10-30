import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import { button, paragraph, renderEmailLayout } from "./layout.template.js";

export interface WelcomeEmailTemplateInput {
  firstName: string;
  /** Absolute URL of the SDK catalog in the portal. */
  catalogUrl: string;
}

// Sent once the account is active (password set)
export function renderWelcomeEmail(
  input: WelcomeEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const url = escapeHtml(input.catalogUrl);

  return {
    subject: "Welcome to EMASS Toolkit",
    html: renderEmailLayout({
      title: "Welcome to EMASS Toolkit",
      preheader: "Your account is ready. SDKs and documentation are waiting.",
      hero: {
        title: `Welcome, ${input.firstName}`,
        subtitle: "Your EMASS Portal account is ready.",
      },
      reason:
        "You're receiving this because your EMASS Portal account is now active.",
      body: [
        paragraph(
          `Hi ${firstName}, you can now download EMASS SDKs, drivers and documentation for every release from the portal.`,
        ),
        button(url, "Browse releases"),
      ].join("\n"),
    }),
    text: `Welcome, ${input.firstName}\n\nYou can now download EMASS SDKs, drivers and documentation for every release from the portal:\n\n${input.catalogUrl}`,
  };
}
