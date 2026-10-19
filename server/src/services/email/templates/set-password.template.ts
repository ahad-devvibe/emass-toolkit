import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  heading,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
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
      body: [
        heading(`Hi ${firstName}, your account is approved`),
        paragraph(
          `Choose a password to activate your EMASS Toolkit account. This link expires in ${expiry} hours.`,
        ),
        button(url, "Set your password"),
        linkFallback(url),
        securityNote(
          "If you did not sign up for EMASS Toolkit, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nHi ${input.firstName}, your account is approved.\n\nChoose a password to activate it (link expires in ${input.expiresInHours} hours):\n\n${input.url}\n\nIf you did not sign up, you can safely ignore this email.`,
  };
}
