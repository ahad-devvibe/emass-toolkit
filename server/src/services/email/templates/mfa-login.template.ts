import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  infoTable,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface MfaLoginEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

export function renderMfaLoginEmail(
  input: MfaLoginEmailTemplateInput,
): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Your EMASS Toolkit login code",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit login code",
      preheader: `Your login code expires in ${input.expiresInMinutes} minutes.`,
      eyebrow: "Account security",
      hero: {
        title: "Your sign-in code",
        subtitle: "Staff accounts confirm every sign-in with a one-time code.",
      },
      reason:
        "You're receiving this because a sign-in to your EMASS Toolkit staff account was started.",
      body: [
        paragraph(
          "Enter this code on the sign-in screen to finish signing in to EMASS Toolkit.",
        ),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        infoTable([
          ["Valid for", `${expiry} minutes`],
          ["Use", "Once, for this sign-in only"],
        ]),
        securityNote(
          "For your security, never share this code. Nanoveu will never ask you for it. If you did not try to sign in, someone may know your password: reset it from the sign-in page.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Account security\n\nYour sign-in code\n\nEnter this code on the sign-in screen to finish signing in:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes. It works once.\n\nFor your security, never share this code. Nanoveu will never ask you for it. If you did not try to sign in, someone may know your password: reset it from the sign-in page.`,
  };
}
