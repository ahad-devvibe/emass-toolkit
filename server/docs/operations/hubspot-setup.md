---
title: HubSpot setup
status: active
updated: 2026-10-26
---

# HubSpot setup

Connect the portal to a HubSpot account once. After that the portal sends
customer contacts one way (portal → HubSpot): sign-up details, use case and
download activity. Background: the HubSpot section of `docs/auth/auth-module.md`.

## 1. Create the private app

1. In HubSpot, open **Settings** (gear) → **Integrations** → **Private Apps** →
   **Create a private app**. Newer accounts list this under
   **Development** → **Legacy apps**.
2. **Basic info:** name it `EMASS portal`.
3. **Scopes:** tick exactly these:

   | Scope | Why |
   |---|---|
   | `crm.objects.contacts.read` | find contacts |
   | `crm.objects.contacts.write` | create and update contacts, and add the first-download note |
   | `crm.schemas.contacts.read` | the Settings connection check reads the portal's fields |
   | `crm.schemas.contacts.write` | the setup script creates the portal's fields |

   If the scope list shows a separate **notes** write scope, tick it too.
   Without it, totals still update but the first-download note is refused
   (logged on the server).
4. **Create app** → **Show token** → copy the access token (`pat-…`).

## 2. Configure the server

In `server/.env`:

```
HUBSPOT_ENABLED=true
HUBSPOT_API_KEY=pat-xxxxxxxx
```

Keep the token out of git; it's a secret. Restart the server.

## 3. Create the portal's fields

From `server/`:

```
npm run hubspot:setup -- --dry-run   # shows what would change, writes nothing
npm run hubspot:setup                # creates or updates the fields
```

Every line should end in `created` or `already up to date`:

```
hubspot-setup: emass_use_case: created
hubspot-setup: emass_download_count: created
hubspot-setup: emass_first_download_at: created
hubspot-setup: emass_last_download_at: created
hubspot-setup: emass_first_download: created
hubspot-setup: emass_last_download: created
```

The script is safe to run again at any time, and it never deletes anything.
Run it again after any portal update that adds HubSpot fields.

| Field (label in HubSpot) | Filled with |
|---|---|
| EMASS use case | what the person said at sign-up they'll use EMASS for |
| EMASS download count | total files downloaded |
| EMASS first download | date of the first download |
| EMASS last download | date of the latest download |
| EMASS first downloaded file | e.g. "EMASS Core SDK v1.2.0: emass-mac.dmg" |
| EMASS last downloaded file | e.g. "EMASS Core SDK v1.4.0: emass-win.zip" |

**Older setups:** an earlier version of the script also created **EMASS
Portal Status** (`emass_portal_status`). The portal no longer uses it. Delete
it in HubSpot: **Settings** → **Properties** → **Contact properties** → search
"EMASS Portal Status" → **Delete**.

A note is also added to the contact's timeline on their first download.

## 4. Check both sides are in sync

- **Portal:** sign in as an admin → **Settings** (gear next to your name in
  the sidebar, or the account menu). HubSpot should say **Connected**.
  - "Isn't fully set up": a field is missing, so run step 3 again.
  - "Rejected the connection": the token is wrong or revoked, so redo step 1.
  - "Doesn't allow everything": a scope is missing, so add it in the app,
    then copy the token again if HubSpot issued a new one.
- **HubSpot:** **Settings** → **Properties** → **Contact properties**, search
  `EMASS`; all six fields are listed.

## Staying in sync

Nothing to run day to day.
- **Each customer download updates the portal's own totals first,** then the
  contact (count, first and last date and file). HubSpot always receives the
  portal's numbers; it never adds them up itself, so a retry can't miscount.
- **If HubSpot is down or the token is wrong,** the download still works.
  That customer's next download resends their latest totals, so nothing is
  lost, just late.
- **The first-download note is sent exactly once.** If it failed, it's
  retried on the customer's next download.
- **To fix everyone at once** (right after first setup, after an outage, or
  after changing the token), run from `server/`. This also covers customers
  who won't download again soon:

  ```
  npm run hubspot:resync
  ```

  It prints how many customers it synced and how many are still waiting. If
  some are still waiting, check Settings: HubSpot is probably not Connected.

## 5. Show the fields on every contact

The fields fill in automatically, but HubSpot doesn't display custom fields on
the contact page until you add them. To show them for every user:

1. **Settings** → **Objects** → **Contacts** → **Record customization** →
   **Default view** (or customize the view your sales team uses).
2. **Key information at the top (Data highlights):** in the middle column's
   **Overview** tab, edit the **Data highlights** card (up to 4 fields) and pick:
   - EMASS download count;
   - EMASS first downloaded file;
   - EMASS last downloaded file;
   - EMASS last download.
3. **Left sidebar:** in **About this contact**, add **EMASS use case** (long
   text reads better here) and **EMASS first download** (the date).
4. **Save**. Every contact now shows the fields; the first-download note is
   already in the activity timeline.

**Optional:** in **Contacts** → the table view → **Edit columns**, add
**EMASS download count** and **EMASS last download** to sort and filter
contacts by activity.
