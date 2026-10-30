import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface PendingApprovalEmailTemplateInput {
  firstName: string;
}

// Personal-domain signups wait for an admin; this confirms the request arrived
export function renderPendingApprovalEmail(
  input: PendingApprovalEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);

  return {
    subject: "Your EMASS Toolkit signup is pending review",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit signup is pending review",
      preheader:
        "We've received your request and will email you once it's reviewed.",
      hero: { title: "We've received your request" },
      reason:
        "You're receiving this because you requested access to the EMASS Portal.",
      body: [
        paragraph(
          `Thanks, ${firstName}. Our team reviews each request by hand, usually within one business day.`,
        ),
        paragraph(
          "We'll email you once it's approved, and you can then sign in with the password you just set.",
        ),
        securityNote("If you didn't sign up, you can ignore this email."),
      ].join("\n"),
    }),
    text: `We've received your request\n\nThanks, ${input.firstName}. Our team reviews each request by hand, usually within one business day.\n\nWe'll email you once it's approved, and you can then sign in with the password you just set.\n\nIf you didn't sign up, you can ignore this email.`,
  };
}
