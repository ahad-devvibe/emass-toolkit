# Demo sign-in + role-based layouts

Status: implemented, pending manual QA (2026-10-17). Typecheck, lint and build
pass.
Scope: `client/` only. No server, Prisma or package changes.

## What was built

- `/sign-in` page: a brand panel plus a form with inline validation, a
  show/hide password toggle and a demo-accounts panel (click to fill).
- Frontend-only demo auth in `client/src/auth/`:
  - `AuthProvider` with `useAuth()` exposes `user`, `signIn` and `signOut`.
  - `RequireAuth` guards routes and remembers the page to return to after
    sign-in.
  - The session (user object only, never the password) is stored in
    `localStorage["emass-session"]`. A saved session only counts if it still
    matches a known account.
- Role-based shells. Pages still render `<AppShell>`, which picks the shell:
  - `CUSTOMER` → `CustomerShell`: a slim top bar (logo, theme toggle, user
    menu) and no sidebar. Catalog and product details only.
  - `DEV` / `ADMIN` → `StaffShell`: the existing sidebar dashboard, now showing
    the signed-in user. The two roles are identical for now.
- `UserMenu` (avatar dropdown with name, email, role and Sign out),
  `UserAvatar`, `ThemeToggle` and `useThemeToggle` were extracted as shared
  pieces.
- The catalog banner greets customers by first name.

## Demo accounts

| Role     | Email                  | Password         |
| -------- | ---------------------- | ---------------- |
| CUSTOMER | `customer@example.com` | `Customer#2026`  |
| DEV      | `dev@example.com`      | `Developer#2026` |
| ADMIN    | `admin@example.com`    | `Admin#2026`     |

## Key decisions

- Frontend demo login instead of the real `/api/auth/*`. The real flow needs a
  dev-DB migration (not yet approved) and an email OTP step for DEV/ADMIN.
- Roles and the user shape mirror the server (`UserRole` enum, a subset of
  `/api/auth/me`), so the swap stays inside `AuthProvider`.
- A failed sign-in shows the generic "Invalid email or password", matching the
  backend's `INVALID_CREDENTIALS`.

## Risks / follow-ups

- **Not access control.** Credentials ship in the JS bundle and the role check
  is client-side only. AGENTS.md requires server-side role enforcement, which
  arrives with the real auth. Do not put real files behind this.
- Swap path: in `AuthProvider`, replace the demo lookup with `POST
  /api/auth/login` → (DEV/ADMIN) `POST /api/auth/verify-otp` → `GET
  /api/auth/me`. That needs an OTP step in the sign-in UI and token refresh.
  Then delete `demo-accounts.ts` and the demo panel.
- The DEV and ADMIN dashboards will diverge later (stage vs. approve, publish
  and roll back).
