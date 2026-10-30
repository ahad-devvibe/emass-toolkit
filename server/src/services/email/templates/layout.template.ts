import { env } from "../../../configs/env.js";
import { escapeHtml } from "../email.utils.js";

// Nanoveu palette, kept in sync with the portal's auth pages. Email clients
// ignore CSS variables, external fonts and SVG, so styles are inlined, fonts
// fall back to system ones, and the header is a hosted JPEG + PNG logo.
const color = {
  page: "#EEF4FB",
  card: "#FFFFFF",
  border: "#DCE7F3",
  navy: "#0F3678",
  primary: "#0B76BB",
  sky: "#7CC6F8",
  tint: "#F3F8FD",
  text: "#1E2B40",
  muted: "#556A8F",
  subtle: "#8597B5",
};

const font =
  "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const mono =
  "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export const SUPPORT_ADDRESS = "info@nanoveu.com";

/**
 * Header images live with the portal's static files (client/public/email/,
 * built by scripts/email-assets/build_header.py): the auth panel's navy
 * gradient and chip photo, and the white EMASS logo.
 */
export function emailAssetUrl(file: string): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/email/${file}`;
}

export interface EmailLayoutInput {
  /** Document title; also used by some clients as the subject fallback. */
  title: string;
  /** Hidden inbox preview line shown after the subject. */
  preheader: string;
  /** Title (and optional subtitle) on the header image; plain text, escaped here. */
  hero: { title: string; subtitle?: string };
  /** Pre-built, already-escaped HTML for the card body. */
  body: string;
  /** Why the recipient got this email; shown in the footer. Plain text, escaped here. */
  reason: string;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px; color:${color.text}; font-family:${font}; font-size:15px; line-height:1.65;">${text}</p>`;
}

/** One-time code, large and spaced, with its expiry underneath. */
export function codeBlock(code: string, caption: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
                  <tr><td align="center" style="padding:22px 16px; background-color:${color.tint}; border:1px solid ${color.border}; border-radius:12px; color:${color.navy}; font-family:${mono}; font-size:32px; font-weight:700; letter-spacing:8px; line-height:1;">${code}</td></tr>
                  <tr><td align="center" style="padding:10px 0 0; color:${color.muted}; font-family:${font}; font-size:13px; line-height:1.5;">${caption}</td></tr>
                </table>`;
}

export function button(url: string, label: string): string {
  // Centered by the outer cell: Outlook ignores margin:auto on tables
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
                  <tr>
                    <td align="center">
                      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                        <tr>
                          <td bgcolor="${color.primary}" style="border-radius:12px; background-color:${color.primary};">
                            <a href="${url}" style="display:inline-block; padding:13px 26px; border-radius:12px; color:#ffffff; font-family:${font}; font-size:15px; font-weight:700; text-decoration:none;">${label}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>`;
}

export function linkFallback(url: string): string {
  return `<p style="margin:0 0 16px; color:${color.muted}; font-family:${font}; font-size:13px; line-height:1.6;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${color.primary}; word-break:break-all;">${url}</a></p>`;
}

/** A note someone on the team wrote for this recipient; already-escaped HTML. */
export function callout(label: string, text: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">
                  <tr><td style="padding:14px 16px; background-color:${color.tint}; border-left:3px solid ${color.primary}; border-radius:8px; font-family:${font}; font-size:14px; line-height:1.6;">
                    <span style="display:block; margin:0 0 4px; color:${color.navy}; font-weight:700;">${label}</span>
                    <span style="color:${color.text};">${text}</span>
                  </td></tr>
                </table>`;
}

/** The one small closing line, e.g. "If you didn't ask for this, ignore this email." */
export function securityNote(text: string): string {
  return `<p style="margin:24px 0 0; padding-top:16px; border-top:1px solid ${color.border}; color:${color.subtle}; font-family:${font}; font-size:13px; line-height:1.6;">${text}</p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const title = escapeHtml(input.title);
  const preheader = escapeHtml(input.preheader);
  const heroTitle = escapeHtml(input.hero.title);
  const heroSubtitle = input.hero.subtitle
    ? escapeHtml(input.hero.subtitle)
    : "";
  const reason = escapeHtml(input.reason);
  const header = emailAssetUrl("header.jpg");
  const logo = emailAssetUrl("emass-logo-white.png");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${color.page}; color:${color.text}; font-family:${font};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${color.page};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; border-collapse:separate; background-color:${color.card}; border:1px solid ${color.border}; border-radius:16px;">
            <tr>
              <td bgcolor="${color.navy}" background="${header}" style="background-color:${color.navy}; background-image:url('${header}'); background-size:cover; background-position:center; border-radius:15px 15px 0 0; padding:28px 32px 32px;">
                <img src="${logo}" width="132" height="53" alt="EMASS, a Nanoveu business" style="display:block; width:132px; height:auto; border:0; outline:none; text-decoration:none;">
                <h1 style="margin:36px 0 0; color:#ffffff; font-family:${font}; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-0.3px;">${heroTitle}</h1>
                ${heroSubtitle ? `<p style="margin:8px 0 0; color:#DCEBFF; font-family:${font}; font-size:15px; line-height:1.55;">${heroSubtitle}</p>` : ""}
                <div style="width:40px; height:3px; margin:18px 0 0; border-radius:2px; background-color:${color.sky}; font-size:0; line-height:0;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${input.body}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
            <tr>
              <td align="center" style="padding:20px 16px 0; color:${color.subtle}; font-family:${font}; font-size:12px; line-height:1.6;">
                <p style="margin:0 0 4px; color:${color.muted}; font-weight:700;">Nanoveu · EMASS Portal</p>
                <p style="margin:0 0 4px;">${reason}</p>
                <p style="margin:0;">Questions? <a href="mailto:${SUPPORT_ADDRESS}" style="color:${color.primary}; text-decoration:none;">${SUPPORT_ADDRESS}</a> · This is an automated message.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
