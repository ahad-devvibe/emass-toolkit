import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  infoTable,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
  steps,
  subheading,
} from "./layout.template.js";

export interface SetPasswordEmailTemplateInput {
  firstName: string;
  url: string;
  expiresInHours: number;
}

export function renderSetPasswordEmail(
  input: SetPasswordEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const url = escapeHtml(input.url);
  const expiry = escapeHtml(String(input.expiresInHours));

  return {
    subject: "Set your EMASS Toolkit password",
    html: renderEmailLayout({
      title: "Set your EMASS Toolkit password",
      preheader: `Choose a password to activate your account. The link expires in ${input.expiresInHours} hours.`,
      eyebrow: "Account approved",
      hero: {
        title: "You're in. Let's finish setup.",
        subtitle: "Your EMASS Toolkit access is approved.",
      },
      reason:
        "You're receiving this because an EMASS Toolkit account was created with this email address.",
      body: [
        paragraph(
          `Hi ${firstName}, your account is approved. Choose a password to activate it. This link expires in ${expiry} hours.`,
        ),
        button(url, "Set your password"),
        infoTable([
          ["Link expires", `in ${expiry} hours`],
          ["Link works", "Once"],
        ]),
        subheading("What happens next"),
        steps([
          {
            title: "Set a password",
            text: "Use at least 6 characters. A password manager makes this easy.",
          },
          {
            title: "Sign in",
            text: "Use this email address and your new password.",
          },
          {
            title: "Download your first SDK",
            text: "Every file comes with release notes and a SHA-256 checksum.",
          },
        ]),
        linkFallback(url),
        securityNote(
          "If you did not sign up for EMASS Toolkit, you can safely ignore this email. No account is activated until a password is set.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Account approved\n\nHi ${input.firstName}, your account is approved.\n\nChoose a password to activate it. The link expires in ${input.expiresInHours} hours and works once:\n\n${input.url}\n\nWhat happens next:\n1. Set a password (at least 6 characters).\n2. Sign in with this email address.\n3. Download your first SDK, with release notes and a SHA-256 checksum.\n\nIf you did not sign up, you can safely ignore this email. No account is activated until a password is set.`,
  };
}
