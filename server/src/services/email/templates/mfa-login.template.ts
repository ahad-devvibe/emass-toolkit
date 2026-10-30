import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface MfaLoginEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

// Staff accounts confirm every sign-in with a one-time code
export function renderMfaLoginEmail(
  input: MfaLoginEmailTemplateInput,
): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Your EMASS Toolkit login code",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit login code",
      preheader: `Your sign-in code expires in ${input.expiresInMinutes} minutes.`,
      hero: {
        title: "Your sign-in code",
        subtitle: "Use this code to finish signing in.",
      },
      reason:
        "You're receiving this because someone started signing in to your EMASS Portal staff account.",
      body: [
        paragraph("Enter this code on the sign-in page:"),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        securityNote(
          "Never share this code. If this wasn't you, reset your password from the sign-in page.",
        ),
      ].join("\n"),
    }),
    text: `Your sign-in code\n\nEnter this code on the sign-in page:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes.\n\nNever share this code. If this wasn't you, reset your password from the sign-in page.`,
  };
}
