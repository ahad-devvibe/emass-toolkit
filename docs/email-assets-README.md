# EMASS Portal: email header images. Do not delete or rename.

This folder holds the images shown at the top of every email the **EMASS Portal** sends. The portal is Nanoveu's download site for EMASS SDKs. The emails include sign-in codes, password resets, welcome messages, and release notices.

| File | Content-Type | What it is |
|---|---|---|
| `header.jpg` | `image/jpeg` | The header photo, a navy chip image |
| `emass-logo-white.png` | `image/png` | The white EMASS logo on top of it |

## Who uses them

The EMASS Toolkit API uses them. It runs on an OCI virtual machine in a **different tenancy** from this bucket. It finds this folder through one setting in its `server/.env`:

```
EMAIL_ASSET_BASE_URL=https://objectstorage.me-dubai-1.oraclecloud.com/n/axa9wwwy80rq/b/Sada_Hisab_DemoBuck/o/email
```

The two file names are fixed in the portal's code: `server/src/services/email/templates/layout.template.ts`.

## Why they live here

Gmail, Outlook and other mail providers fetch email images anonymously, from their own servers. The portal's own buckets are private, and a pre-authenticated link would expire, so the images live in this public bucket instead.

## Rules

- **Never delete, rename or move these files.** Every email already sent points at them; without them, those emails lose their header.
- **Keep the bucket public**, with visibility "Public, ObjectRead" (no listing).
- **Keep the Content-Types** `image/jpeg` and `image/png`. Without them, some mail clients won't show the images.
- **Don't put anything private in this folder.** Anyone can read it, including this file.

## Changing an image

1. Upload the new image under a **new name** (for example `emass-logo-white-v2.png`), so old emails keep the old one.
2. Change the file name in `layout.template.ts` and deploy the API.
3. To rebuild the header photo, run `python scripts/email-assets/build_header.py` in the repository. The source images are in `client/public/email/`.

## Moving to another bucket

1. Copy both files to the new bucket, with the same names and Content-Types.
2. Update `EMAIL_ASSET_BASE_URL` on the API server and restart the API.
3. Leave the copies here, for emails already sent.

## Checking

Each of these should return `200` with the right `Content-Type`:

```
curl -I https://objectstorage.me-dubai-1.oraclecloud.com/n/axa9wwwy80rq/b/Sada_Hisab_DemoBuck/o/email/header.jpg
curl -I https://objectstorage.me-dubai-1.oraclecloud.com/n/axa9wwwy80rq/b/Sada_Hisab_DemoBuck/o/email/emass-logo-white.png
```

More detail is in `server/docs/architecture.md` §8 of the EMASS Toolkit repository. This file's copy in the repository is `docs/email-assets-README.md`.
