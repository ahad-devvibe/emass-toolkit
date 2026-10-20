import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  infoTable,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export type { RenderedEmail } from "../email.utils.js";

export interface OtpEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

export function renderOtpVerificationEmail(
  input: OtpEmailTemplateInput,
): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Your EMASS Toolkit verification code",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit verification code",
      preheader: `Your verification code expires in ${input.expiresInMinutes} minutes.`,
      eyebrow: "Verification",
      hero: {
        title: "Verify it's you",
        subtitle: "One quick step to keep your account secure.",
      },
      reason:
        "You're receiving this because a verification code was requested for your EMASS Toolkit account.",
      body: [
        paragraph(
          "Enter this code to continue with your EMASS Toolkit account.",
        ),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        infoTable([
          ["Valid for", `${expiry} minutes`],
          ["Use", "Once"],
        ]),
        securityNote(
          "For your security, never share this code. If you did not request it, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Verification\n\nVerify it's you\n\nEnter this code to continue with your EMASS Toolkit account:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes. It works once.\n\nFor your security, never share this code. If you did not request it, you can safely ignore this email.`,
  };
}
