import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  linkFallback,
  paragraph,
  renderEmailLayout,
} from "./layout.template.js";

export interface SetPasswordEmailTemplateInput {
  firstName: string;
  url: string;
  expiresInHours: number;
}

// Sent when an account is approved (or created by an admin) and needs a password
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
      preheader: `Your account is approved. Set your password within ${input.expiresInHours} hours.`,
      hero: {
        title: "Your account is approved",
        subtitle: "Set a password to start using the EMASS Portal.",
      },
      reason:
        "You're receiving this because an EMASS Portal account was created with this email address.",
      body: [
        paragraph(
          `Hi ${firstName}, your account is approved. Set your password to activate it. This link expires in ${expiry} hours.`,
        ),
        button(url, "Set your password"),
        linkFallback(url),
      ].join("\n"),
    }),
    text: `Your account is approved\n\nHi ${input.firstName}, your account is approved. Set your password to activate it. This link expires in ${input.expiresInHours} hours:\n\n${input.url}`,
  };
}
