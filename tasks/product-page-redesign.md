# Product page redesign (`/catalog/:productId`)

Status: implemented, pending manual QA (2026-10-17). Typecheck, lint and build
pass.
Scope: `client/` only (mock data). No server changes.

## What was built

- **Compact header** (`ProductHeader.tsx`) replaces the tall image hero, so
  downloads are visible without scrolling. It has a thumbnail, name, detail,
  status, release date, file count and supported-OS icons, plus a **version
  picker**.
- The **version picker** replaces the sticky "Latest stable / Previous
  versions" bar and the previous-versions accordion. It is driven by
  `?version=` so an archived selection can be shared. Unknown values fall back
  to latest, and archived versions show an amber notice with a "View latest"
  action.
- **Files grouped by kind** (`ReleaseFiles.tsx`, `FileRow.tsx`): SDK,
  Documentation and Manuals. Each row shows an icon, title, arch/format tag,
  filename, size, short SHA-256 (tooltip + copy) and Download.
  - SDK rows use real OS logos (Windows/Apple/Linux via `react-icons/fa6`) and
    the architecture.
  - The visitor's OS is detected, floated to the top and marked "Recommended
    for your system" with a primary button.
- **Release notes** (`ReleaseNotes.tsx`): optional Markdown (GFM: lists,
  tables, code, blockquotes), collapsed by default. The parser is lazy-loaded
  on first open as a separate 47 kB gzipped chunk. Raw HTML in notes is not
  rendered.
- **Removed:** install commands (data and UI), the "What's included" list
  (superseded by release notes), and the support sidebar. Support is now one
  line in the page footer.
- **Catalog card:** shows OS icons and file kinds, with "View downloads" as the
  primary action. The card-level download was removed because it couldn't
  know which OS or file the user wanted.

## Revision 2: declutter + right rail (2026-10-17)

- The first pass felt dense: three text lines per file row, a description per
  group, and monospace everywhere.
- **File rows are two lines.** Line one is OS or title with a muted arch or
  format, plus a "Your OS" pill. Line two is size · `sha256:` short hash
  (click to copy, full hash in a tooltip). The filename moved to a hover
  title. On mobile the Download button is icon-only.
- **Every section is collapsible** (`Section.tsx` on native `<details>`). The
  file groups start open and release notes start closed.
- **Right rail** (`ReleaseSidebar.tsx`, sticky on `lg`) has three panels:
  - *This release*: version, status, date, file count and total size,
    platforms, and the checksum note.
  - *Versions*: a visible history with dates and a Latest tag. It shows 5 and
    has a "Show all" option.
  - *Resources*: release notes (opens and scrolls to them), documentation,
    and support.
- **Versions:** a dropdown alone hides the history, so the rail list is the
  primary switcher. The header dropdown remains only below `lg`, where the
  rail stacks under the content.
- **Header** is reduced to a small thumbnail, name and one-line description.
  The archived notice is a single line.

## Data model (`pages/Catalog/catalog.types.ts`)

- `ReleaseFile = SdkFile | DocumentFile`, discriminated on `kind`.
  - `SdkFile`: `kind: "sdk"`, `os: windows | macos | linux`, `arch`.
  - `DocumentFile`: `kind: "documentation" | "manual"`, `title`, `format`.
  - Both carry `name`, `size` and `checksum` (SHA-256).
- `Release.releaseNotes?: string` (Markdown). `notes[]` and `command` were
  removed.
- Kind and OS labels, icons and display order live in `catalog.meta.ts`. Add a
  new file kind there and it gets its own group automatically.

## Key decisions

- New dependencies: `react-icons` (tree-shaken, only 3 icons ship),
  `react-markdown` and `remark-gfm`.
- The version picker beats a long previous-versions list. Most visitors want
  latest, and the rest know which version they need.

## Risks / follow-ups

- When the backend lands, the Prisma `ReleaseFile` model needs `kind`, `os`,
  `arch`, `title` and `format` columns, and `Release` needs `releaseNotes`
  (text). Migration needs explicit approval.
- OS detection is best-effort (User-Agent / UA-CH). It only affects ordering
  and the hint, never what the user can download.
- The main bundle grew about 40 kB gzipped (Base UI Select, icon runtime).
  Route-level code splitting is a possible follow-up.
