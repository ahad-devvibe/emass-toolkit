# Email templates: Nanoveu theme + welcome email

Status: implemented, pending visual QA in real mail clients (2026-10-19).
Scope: `server/src/services/email/` plus the set-password flow.

## What was built

- **Shared layout** (`templates/layout.template.ts`) replaces the orange
  starter-kit styling that was copied into all six templates.
  - Wordmark ("EMASS Toolkit by Nanoveu") above a white card on an ice-blue
    page, with a 3px brand-blue top edge and a footer line.
  - The colours mirror the client's light theme in `client/src/index.css`.
  - Building blocks: `heading`, `paragraph`, `muted`, `bulletList`,
    `codeBlock`, `button`, `linkFallback`, `securityNote`.
  - Each email has a hidden preheader for the inbox preview line.
- **Restyled:** OTP verification, MFA login, password reset, pending approval,
  set password and set-password reminder.
  - Text is left-aligned and shorter. Codes show in monospace on a light-blue
    tile instead of a solid orange block.
  - The set-password heading is now "Hi {name}, your account is approved",
    because "Welcome" belongs to the new email.
  - The MFA email tells the user to reset their password if they didn't try to
    sign in. The code is sent only after a correct password, so this is
    accurate.
  - The reminder says earlier links no longer work, because the reminder sweep
    re-issues the token.
- **New welcome email** (`templates/welcome.template.ts`, subject "Welcome to
  EMASS Toolkit").
  - Sent from `redeemSetPasswordToken` once the account becomes ACTIVE.
  - It lists what the portal offers (SDK downloads, SHA-256 verification,
    release notes and older versions) and links to `{APP_BASE_URL}/catalog`.
  - Added `EmailSender.sendWelcomeEmail` to the OCI and console senders and
    to the test mock.

## Key decisions

- **No images or web fonts** (an existing test enforces this). Plus Jakarta
  Sans and JetBrains Mono come first in the font stacks, and system fonts
  apply wherever they aren't installed.
- **Light scheme only** (`color-scheme: light`). Auto dark mode in Gmail and
  Outlook is unreliable, so we don't fight it.
- **The welcome email is best-effort.** A failed send is logged and doesn't
  fail the set-password request, because the account is already active.

## Risks / follow-ups

- Not yet checked in Outlook desktop, Gmail or Apple Mail. Rounded corners and
  the coloured top border degrade gracefully in Outlook.
- Add the real Nanoveu logo once there is a hosted, CDN-safe PNG. That would
  require relaxing the no-`<img>` test.
- Integration tests (`set-password.test.ts`, which has a new welcome-email
  assertion and a failure-path test) couldn't run locally because the test DB
  credentials were rejected (28P01). They need a run against a working
  `.env.test`.
