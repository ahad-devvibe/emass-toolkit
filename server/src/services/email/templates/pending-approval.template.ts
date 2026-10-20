import type { RenderedEmail } from "../email.utils.js";
import {
  callout,
  paragraph,
  renderEmailLayout,
  securityNote,
  subheading,
  timeline,
} from "./layout.template.js";

export interface PendingApprovalEmailTemplateInput {
  firstName: string;
}

export function renderPendingApprovalEmail(
  input: PendingApprovalEmailTemplateInput,
): RenderedEmail {
  return {
    subject: "Your EMASS Toolkit signup is pending review",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit signup is pending review",
      preheader: "Our team is reviewing your request. No action needed.",
      eyebrow: "Request received",
      hero: {
        title: `Thanks, ${input.firstName}. We're on it.`,
        subtitle: "Your request for EMASS Toolkit access is with our team.",
      },
      reason:
        "You're receiving this because you requested access to EMASS Toolkit.",
      body: [
        paragraph(
          "Because you registered with a personal email address, our team reviews each request by hand. There's nothing you need to do right now.",
        ),
        subheading("Where things stand"),
        timeline([
          { label: "Request submitted", state: "done" },
          {
            label: "Team review",
            note: "Usually within one business day.",
            state: "current",
          },
          {
            label: "Set your password",
            note: "Once approved, we'll email you a link to activate your account.",
            state: "next",
          },
        ]),
        callout(
          "<strong>Tip:</strong> signing up with your company email address skips the review and gets you access right away.",
        ),
        securityNote(
          "If you did not sign up for EMASS Toolkit, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Request received\n\nThanks, ${input.firstName}.\n\nBecause you registered with a personal email address, our team reviews each request by hand. There's nothing you need to do right now.\n\nWhere things stand:\n[x] Request submitted\n[ ] Team review (usually within one business day)\n[ ] Set your password (we'll email you a link once approved)\n\nTip: signing up with your company email address skips the review.\n\nIf you did not sign up, you can safely ignore this email.`,
  };
}
