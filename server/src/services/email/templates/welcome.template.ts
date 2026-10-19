import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  bulletList,
  button,
  heading,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface WelcomeEmailTemplateInput {
  firstName: string;
  /** Absolute URL of the SDK catalog in the portal. */
  catalogUrl: string;
}

const highlights = [
  "Download the latest EMASS SDKs for Windows, macOS and Linux.",
  "Verify every file against its published SHA-256 checksum.",
  "Read release notes and grab earlier versions when you need them.",
];

export function renderWelcomeEmail(
  input: WelcomeEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const url = escapeHtml(input.catalogUrl);

  return {
    subject: "Welcome to EMASS Toolkit",
    html: renderEmailLayout({
      title: "Welcome to EMASS Toolkit",
      preheader: "Your account is active. Your SDK downloads are ready.",
      body: [
        heading(`Welcome, ${firstName}`),
        paragraph(
          "Your EMASS Toolkit account is active. Here is what you can do in the portal:",
        ),
        bulletList(highlights),
        button(url, "Browse the SDK catalog"),
        linkFallback(url),
        securityNote(
          "You received this because a password was just set for your EMASS Toolkit account. If that was not you, reset your password from the sign-in page right away.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nWelcome, ${input.firstName}\n\nYour EMASS Toolkit account is active. Here is what you can do in the portal:\n\n${highlights.map((item) => `- ${item}`).join("\n")}\n\nBrowse the SDK catalog: ${input.catalogUrl}\n\nIf you did not just set a password for this account, reset it from the sign-in page right away.`,
  };
}
