import { escapeHtml } from "../email.utils.js";

// Nanoveu palette, kept in sync with client/src/index.css (light theme).
// Email clients ignore CSS variables and external fonts, so everything is
// inlined, falls back to system fonts, and gradients carry a solid bgcolor
// fallback for clients (Outlook) that drop background-image.
const color = {
  page: "#EEF4FB",
  card: "#FFFFFF",
  border: "#DCE7F3",
  navy: "#0F3678",
  primary: "#0976BC",
  sky: "#2EA7F5",
  powder: "#C3DFFF",
  tint: "#F3F8FD",
  tintStrong: "#EAF6FF",
  text: "#1E2B40",
  muted: "#556A8F",
  subtle: "#8597B5",
  success: "#12A37A",
  terminal: "#0F2747",
  terminalText: "#E6F1FF",
};

const fontSans =
  "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const fontMono =
  "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

// Same gradient + dot texture as the portal's sign-in panel
const heroBackground = `background-color:${color.navy}; background-image:radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(135deg, ${color.navy} 0%, ${color.primary} 62%, ${color.sky} 100%); background-size:18px 18px, 100% 100%;`;

export const EMAIL_TAGLINE = "Smarter · Faster · Greener";

export interface EmailLayoutInput {
  /** Document title; also used by some clients as the subject fallback. */
  title: string;
  /** Hidden inbox preview line shown after the subject. */
  preheader: string;
  /** Small uppercase label above the hero title, e.g. "Account security". */
  eyebrow: string;
  /** Large title (and optional subtitle) on the gradient header band; plain text, escaped here. */
  hero: { title: string; subtitle?: string };
  /** Pre-built, already-escaped HTML for the card body. */
  body: string;
  /** Why the recipient got this email; shown in the footer. Plain text, escaped here. */
  reason: string;
}

const table = (inner: string, style = "") =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate; ${style}">${inner}</table>`;

export function heading(text: string): string {
  return `<h2 style="margin:0 0 12px; color:${color.navy}; font-family:${fontSans}; font-size:20px; line-height:1.35; font-weight:700;">${text}</h2>`;
}

/** Small section label inside the body, e.g. "Get started". */
export function subheading(text: string): string {
  return `<h3 style="margin:28px 0 14px; color:${color.subtle}; font-family:${fontSans}; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">${text}</h3>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px; color:${color.text}; font-family:${fontSans}; font-size:15px; line-height:1.65;">${text}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 16px; color:${color.muted}; font-family:${fontSans}; font-size:14px; line-height:1.6;">${text}</p>`;
}

export function bulletList(items: string[]): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td width="22" valign="top" style="padding:0 0 10px; color:${color.primary}; font-family:${fontSans}; font-size:15px; line-height:1.6; font-weight:700;">&#10003;</td><td style="padding:0 0 10px; color:${color.text}; font-family:${fontSans}; font-size:15px; line-height:1.6;">${item}</td></tr>`,
    )
    .join("");
  return table(rows, "margin:0 0 12px;");
}

/** One-time code, large and spaced, on a tinted tile. */
export function codeBlock(code: string, caption?: string): string {
  return table(
    `<tr><td align="center" style="padding:24px 16px ${caption ? "14px" : "24px"}; background-color:${color.tintStrong}; border:1px solid ${color.border}; border-radius:14px; color:${color.navy}; font-family:${fontMono}; font-size:34px; font-weight:700; letter-spacing:10px; line-height:1;">${code}</td></tr>${
      caption
        ? `<tr><td align="center" style="padding:10px 0 0; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.5;">${caption}</td></tr>`
        : ""
    }`,
    "margin:4px 0 20px;",
  );
}

export function button(url: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;">
                  <tr>
                    <td bgcolor="${color.primary}" style="border-radius:10px; background-color:${color.primary}; box-shadow:0 6px 16px -6px rgba(9,118,188,0.55);">
                      <a href="${url}" style="display:inline-block; padding:14px 28px; border-radius:10px; color:#ffffff; font-family:${fontSans}; font-size:15px; font-weight:700; text-decoration:none;">${label} &rarr;</a>
                    </td>
                  </tr>
                </table>`;
}

export function linkFallback(url: string): string {
  return `<p style="margin:0 0 8px; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.6;">If the button does not work, paste this link into your browser:<br><a href="${url}" style="color:${color.primary}; word-break:break-all;">${url}</a></p>`;
}

/** Tinted block for quoted, user-facing text (e.g. a reviewer's note or a tip). */
export function callout(text: string): string {
  return table(
    `<tr><td style="padding:14px 16px; background-color:${color.tintStrong}; border-left:3px solid ${color.primary}; border-radius:8px; color:${color.text}; font-family:${fontSans}; font-size:14px; line-height:1.6;">${text}</td></tr>`,
    "margin:0 0 16px;",
  );
}

/** Numbered steps; titles and texts are already-escaped HTML. */
export function steps(items: { title: string; text: string }[]): string {
  const rows = items
    .map(
      (item, index) => `<tr>
                    <td width="40" valign="top" style="padding:0 0 18px;">
                      <div style="width:28px; height:28px; border-radius:14px; background-color:${color.primary}; color:#ffffff; font-family:${fontSans}; font-size:13px; font-weight:700; line-height:28px; text-align:center;">${index + 1}</div>
                    </td>
                    <td valign="top" style="padding:3px 0 18px;">
                      <p style="margin:0; color:${color.navy}; font-family:${fontSans}; font-size:15px; font-weight:700; line-height:1.4;">${item.title}</p>
                      <div style="margin:4px 0 0; color:${color.muted}; font-family:${fontSans}; font-size:14px; line-height:1.6;">${item.text}</div>
                    </td>
                  </tr>`,
    )
    .join("");
  return table(rows, "margin:0 0 4px;");
}

/** Label / value rows on a tinted card ("Expires · 10 minutes"); values are escaped HTML. */
export function infoTable(rows: [label: string, value: string][]): string {
  const body = rows
    .map(
      ([label, value], index) =>
        `<tr><td style="padding:12px 16px; ${index > 0 ? `border-top:1px solid ${color.border};` : ""} color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.4;">${label}</td><td align="right" style="padding:12px 16px; ${index > 0 ? `border-top:1px solid ${color.border};` : ""} color:${color.navy}; font-family:${fontSans}; font-size:14px; font-weight:700; line-height:1.4;">${value}</td></tr>`,
    )
    .join("");
  return table(
    body,
    `margin:0 0 20px; background-color:${color.tint}; border:1px solid ${color.border}; border-radius:12px;`,
  );
}

/** Two-column grid of feature tiles; titles and texts are escaped HTML. */
export function featureGrid(items: { title: string; text: string }[]): string {
  const tile = (item?: { title: string; text: string }) =>
    item
      ? `<td width="50%" valign="top" style="padding:6px;">
                      ${table(
                        `<tr><td style="padding:16px; background-color:${color.tint}; border:1px solid ${color.border}; border-radius:12px;">
                          <div style="width:24px; height:3px; margin:0 0 12px; border-radius:2px; background-color:${color.sky};"></div>
                          <p style="margin:0 0 4px; color:${color.navy}; font-family:${fontSans}; font-size:14px; font-weight:700; line-height:1.4;">${item.title}</p>
                          <p style="margin:0; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.55;">${item.text}</p>
                        </td></tr>`,
                      )}
                    </td>`
      : `<td width="50%" style="padding:6px;"></td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(`<tr>${tile(items[i])}${tile(items[i + 1])}</tr>`);
  }
  return table(rows.join(""), "margin:0 0 16px;");
}

/** Progress of a request; `done` gets a check, `current` a ring, `next` a muted dot. */
export function timeline(
  items: { label: string; note?: string; state: "done" | "current" | "next" }[],
): string {
  const marker = {
    done: `background-color:${color.success}; color:#ffffff;`,
    current: `background-color:#ffffff; border:2px solid ${color.primary}; color:${color.primary};`,
    next: `background-color:${color.tint}; border:2px solid ${color.border}; color:${color.subtle};`,
  };
  const rows = items
    .map(
      (item) => `<tr>
                    <td width="40" valign="top" style="padding:0 0 16px;">
                      <div style="width:${item.state === "done" ? "24px" : "20px"}; height:${item.state === "done" ? "24px" : "20px"}; border-radius:12px; ${marker[item.state]} font-family:${fontSans}; font-size:13px; font-weight:700; line-height:${item.state === "done" ? "24px" : "20px"}; text-align:center;">${item.state === "done" ? "&#10003;" : "&nbsp;"}</div>
                    </td>
                    <td valign="top" style="padding:2px 0 16px;">
                      <p style="margin:0; color:${item.state === "next" ? color.muted : color.navy}; font-family:${fontSans}; font-size:15px; font-weight:700; line-height:1.4;">${item.label}</p>
                      ${item.note ? `<p style="margin:2px 0 0; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.55;">${item.note}</p>` : ""}
                    </td>
                  </tr>`,
    )
    .join("");
  return table(rows, "margin:0 0 8px;");
}

/** Terminal-style command, e.g. a checksum command; `command` is escaped here. */
export function commandLine(command: string, label?: string): string {
  return `${label ? `<p style="margin:10px 0 4px; color:${color.subtle}; font-family:${fontSans}; font-size:12px; line-height:1.4;">${escapeHtml(label)}</p>` : ""}<div style="margin:0 0 6px; padding:10px 12px; border-radius:8px; background-color:${color.terminal}; color:${color.terminalText}; font-family:${fontMono}; font-size:13px; line-height:1.5; overflow-wrap:anywhere;"><span style="color:${color.sky};">$</span> ${escapeHtml(command)}</div>`;
}

export function divider(): string {
  return table(
    `<tr><td style="padding:8px 0 24px;"><div style="height:1px; line-height:1px; font-size:1px; background-color:${color.border};">&nbsp;</div></td></tr>`,
  );
}

export function securityNote(text: string): string {
  return `<p style="margin:24px 0 0; padding-top:16px; border-top:1px solid ${color.border}; color:${color.subtle}; font-family:${fontSans}; font-size:13px; line-height:1.6;">${text}</p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const title = escapeHtml(input.title);
  const preheader = escapeHtml(input.preheader);
  const eyebrow = escapeHtml(input.eyebrow);
  const heroTitle = escapeHtml(input.hero.title);
  const heroSubtitle = input.hero.subtitle
    ? escapeHtml(input.hero.subtitle)
    : "";
  const reason = escapeHtml(input.reason);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${color.page}; color:${color.text}; font-family:${fontSans};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${color.page};">
      <tr>
        <td align="center" style="padding:36px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; border-collapse:separate; background-color:${color.card}; border:1px solid ${color.border}; border-radius:18px; box-shadow:0 18px 40px -18px rgba(15,54,120,0.28);">
            <tr>
              <td bgcolor="${color.navy}" style="${heroBackground} border-radius:17px 17px 0 0; padding:28px 32px 34px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="34" height="34" align="center" style="width:34px; height:34px; border-radius:10px; background-color:rgba(255,255,255,0.16); border:1px solid rgba(255,255,255,0.3); color:#ffffff; font-family:${fontSans}; font-size:16px; font-weight:800; line-height:34px;">E</td>
                    <td style="padding-left:12px; color:#ffffff; font-family:${fontSans}; font-size:16px; font-weight:700; letter-spacing:-0.2px;">EMASS Toolkit <span style="font-weight:500; color:rgba(255,255,255,0.7);">by Nanoveu</span></td>
                  </tr>
                </table>
                <p style="margin:30px 0 8px; color:${color.powder}; font-family:${fontSans}; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase;">${eyebrow}</p>
                <h1 style="margin:0; color:#ffffff; font-family:${fontSans}; font-size:28px; line-height:1.25; font-weight:800; letter-spacing:-0.4px;">${heroTitle}</h1>
                ${heroSubtitle ? `<p style="margin:10px 0 0; color:rgba(255,255,255,0.84); font-family:${fontSans}; font-size:15px; line-height:1.55;">${heroSubtitle}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 28px;">
                ${input.body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px; background-color:${color.tint}; border-top:1px solid ${color.border}; border-radius:0 0 17px 17px; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.6;"><strong style="color:${color.navy};">Need a hand?</strong> Reach out to your Nanoveu contact, or sign in to the portal to see your releases and downloads.</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
            <tr>
              <td align="center" style="padding:24px 16px 0; font-family:${fontSans};">
                <p style="margin:0 0 6px; color:${color.primary}; font-size:11px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase;">${EMAIL_TAGLINE}</p>
                <p style="margin:0 0 10px; color:${color.muted}; font-size:12px; line-height:1.6;">Nanoveu · EMASS developer portal</p>
                <p style="margin:0 0 4px; color:${color.subtle}; font-size:12px; line-height:1.6;">${reason}</p>
                <p style="margin:0; color:${color.subtle}; font-size:12px; line-height:1.6;">This is an automated message. Please do not reply.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
