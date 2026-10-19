import { escapeHtml } from "../email.utils.js";

// Nanoveu palette, kept in sync with client/src/index.css (light theme).
// Email clients ignore CSS variables and external fonts, so everything is
// inlined and falls back to system fonts.
const color = {
  page: "#F5FAFF",
  card: "#FFFFFF",
  border: "#DCE7F3",
  navy: "#0F3678",
  primary: "#0976BC",
  tint: "#EAF6FF",
  text: "#1E2B40",
  muted: "#556A8F",
  subtle: "#8597B5",
};

const fontSans =
  "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const fontMono =
  "'JetBrains Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export interface EmailLayoutInput {
  /** Document title; also used by some clients as the subject fallback. */
  title: string;
  /** Hidden inbox preview line shown after the subject. */
  preheader: string;
  /** Pre-built, already-escaped HTML for the card body. */
  body: string;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px; color:${color.navy}; font-family:${fontSans}; font-size:22px; line-height:1.3; font-weight:700;">${text}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px; color:${color.text}; font-family:${fontSans}; font-size:15px; line-height:1.6;">${text}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 16px; color:${color.muted}; font-family:${fontSans}; font-size:14px; line-height:1.6;">${text}</p>`;
}

export function bulletList(items: string[]): string {
  const rows = items
    .map((item) => `<li style="margin:0 0 6px;">${item}</li>`)
    .join("");
  return `<ul style="margin:0 0 20px; padding-left:20px; color:${color.text}; font-family:${fontSans}; font-size:15px; line-height:1.6;">${rows}</ul>`;
}

export function codeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 16px;">
                  <tr>
                    <td align="center" style="padding:20px 16px; background-color:${color.tint}; border:1px solid ${color.border}; border-radius:10px; color:${color.navy}; font-family:${fontMono}; font-size:30px; font-weight:700; letter-spacing:8px; line-height:1;">${code}</td>
                  </tr>
                </table>`;
}

export function button(url: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;">
                  <tr>
                    <td style="border-radius:8px; background-color:${color.primary};">
                      <a href="${url}" style="display:inline-block; padding:12px 24px; border-radius:8px; color:#ffffff; font-family:${fontSans}; font-size:15px; font-weight:600; text-decoration:none;">${label}</a>
                    </td>
                  </tr>
                </table>`;
}

export function linkFallback(url: string): string {
  return `<p style="margin:0 0 16px; color:${color.muted}; font-family:${fontSans}; font-size:13px; line-height:1.6;">If the button does not work, paste this link into your browser:<br><a href="${url}" style="color:${color.primary}; word-break:break-all;">${url}</a></p>`;
}

export function securityNote(text: string): string {
  return `<p style="margin:24px 0 0; padding-top:16px; border-top:1px solid ${color.border}; color:${color.subtle}; font-family:${fontSans}; font-size:13px; line-height:1.6;">${text}</p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const title = escapeHtml(input.title);
  const preheader = escapeHtml(input.preheader);

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
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 16px; font-family:${fontSans}; font-size:15px; font-weight:700; color:${color.navy};">EMASS Toolkit <span style="font-weight:500; color:${color.subtle};">by Nanoveu</span></td>
            </tr>
            <tr>
              <td style="background-color:${color.card}; border:1px solid ${color.border}; border-top:3px solid ${color.primary}; border-radius:12px; padding:32px;">
                ${input.body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0; color:${color.subtle}; font-family:${fontSans}; font-size:12px; line-height:1.6;">This is an automated message from the Nanoveu EMASS Toolkit portal. Please do not reply.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
