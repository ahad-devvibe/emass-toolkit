# Review cards (admin, release in review)

## What was built

When an admin opens a release that is **in review** (`/releases/:id`), four
cards sit under the header. Each is green (ok), amber (check this), red (wrong)
or grey (nothing to judge):

| Card | Shows | Green / amber / red |
|---|---|---|
| **Version** | `v1.134.2 → v1.135.0`, with "major / minor / patch", or "first release" | All files match the version / a file doesn't mention it (`DOC_VERSION_MISMATCH`, `NO_VERSION`) / an installer says another version (`VERSION_MISMATCH`, `VERSION_EXISTS`) |
| **Checksums** | "SHA-256 verified" | All files are new since the live version / a file is byte-identical to one in the live version (named) / an installer repeats an earlier build (`SAME_CONTENT`) or a file has no hash |
| **Core SDKs** | `x / 3 platforms` with icons, "Missing: macOS" | 3 / 2 / 1 or 0 |
| **Docs & release notes** | `2 docs · notes written` | Both present / one missing / both missing |

Code (client only):
- the rules: `client/src/pages/ReleaseDetail/review-cards.ts` (pure, tested in `review-cards.test.ts`);
- the cards: `components/ReviewCards.tsx`, rendered by `ReleaseDetailPage.tsx`.

## Key decisions

- **No server change.** Everything comes from `GET /api/releases/:id`: the file rules' `blockedBy` / `warnings`, `sha256`, `kind` / `os`, `releaseNotes` and `review.currentPublished`.
- **"Unique across previous files" compares with the live version only** (the one publishing would replace). The cards load it with one extra `GET /api/releases/:id`.
  - Installers identical to *any* earlier file are already blocked at upload, so the comparison matters for docs.
  - Comparing with every archived version would need a server change; we chose not to.
- **A doc unchanged from the live version is amber on the card only.** It doesn't become a file-rule warning, which would ask the developer to confirm on submit. Re-shipping last release's guide is normal (see `file-checks.md`).
- **Only admins, only in review.** The same condition as the "Waiting for your review" callout. The cards change nothing; the server enforces who can publish.
- **"Docs & release notes" counts any documentation file** plus the release-notes text. It doesn't look for specific documents by name.

## Assumptions

- **Three platforms (Windows, macOS, Ubuntu) is a complete release.** The SDK card counts out of `osMeta` (`client/src/pages/Catalog/catalog.meta.ts`), so adding a platform there changes the total.

## Risks / follow-ups

- If the live version can't be loaded, the checksum card says so (grey) rather than guessing.
- Approving with amber or red cards is allowed; the cards inform the decision and don't block Publish.
