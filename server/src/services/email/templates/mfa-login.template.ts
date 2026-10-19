import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  heading,
  muted,
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
      body: [
        heading("Your login code"),
        paragraph("Enter this code to finish signing in to EMASS Toolkit."),
        codeBlock(code),
        muted(`This code expires in ${expiry} minutes.`),
        securityNote(
          "For your security, never share this code. If you did not try to sign in, someone may know your password. Reset it from the sign-in page.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nYour login code:\n\n${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes. For your security, never share it. If you did not try to sign in, someone may know your password. Reset it from the sign-in page.`,
  };
}
