import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  heading,
  muted,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface PendingApprovalEmailTemplateInput {
  firstName: string;
}

export function renderPendingApprovalEmail(
  input: PendingApprovalEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);

  return {
    subject: "Your EMASS Toolkit signup is pending review",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit signup is pending review",
      preheader: "Our team is reviewing your request. No action needed.",
      body: [
        heading(`Thanks, ${firstName}`),
        paragraph(
          "We received your EMASS Toolkit signup. Because you registered with a personal email address, our team reviews each request by hand.",
        ),
        paragraph(
          "Once your account is approved, we will email you a link to set your password.",
        ),
        muted("No action is needed right now."),
        securityNote(
          "If you did not sign up for EMASS Toolkit, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nHi ${input.firstName},\n\nWe received your signup. Because you registered with a personal email address, our team reviews each request by hand. Once your account is approved, we will email you a link to set your password.\n\nIf you did not sign up, you can safely ignore this email.`,
  };
}
