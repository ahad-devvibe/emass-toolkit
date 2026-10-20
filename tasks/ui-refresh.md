# UI refresh — Nanoveu brand alignment ("more lively")

Status: implemented, pending manual visual QA (2026-10-17). Typecheck, lint and
build pass.

Implementation notes:
- `muted-foreground` is `#556A8F` (not `#6A7FA3`) to clear AA, about 5.2:1 on
  the tinted page.
- `<Toaster>` moved into `AppShell` and receives the app theme. It previously
  read `next-themes` with no provider, so toasts ignored the toggle.
- The install command box replaces the release-level checksum box. Checksums
  are now per file, in each `ReleaseFileRow`.
Scope: `client/` only. No API, schema or routing changes.

## Goal

Keep the current layout and component structure (sidebar shell, catalog grid,
product hero, release rows). The user likes these. Make the app feel livelier
and visibly Nanoveu by:

1. Swapping the neutral white/grey theme for Nanoveu's soft blue/slate palette.
2. Adding depth with tinted surfaces, brand gradients, soft blue shadows and
   subtle motion.
3. Making key information (version, status, checksum) visually prominent.

Non-goals: a redesign, new pages, new UI libraries, or animation frameworks.
The stack already has `tw-animate-css` and Tailwind v4, which cover all of this.

## Brand reference (extracted from nanoveu.com CSS)

| Role                 | Hex       | Where it shows up on nanoveu.com     |
| -------------------- | --------- | ------------------------------------ |
| Brand blue (primary) | `#0976BC` | Links, CTAs, accents (most used)     |
| Navy (deep)          | `#0F3678` | Headings, dark section backgrounds   |
| Sky (bright accent)  | `#2EA7F5` | Gradient end, highlights             |
| Slate                | `#6A7FA3` | Secondary sections, muted UI         |
| Slate light          | `#93A3BD` | Muted text and dividers              |
| Ice (page bg)        | `#F0F9FF` | Light section backgrounds            |
| Mist                 | `#DCF1FF` | Tinted cards and panels              |
| Powder               | `#C3DFFF` | Gradient start, borders on tint      |
| Border grey          | `#DEE1E7` | Hairlines                            |
| Signature gradient   | `linear-gradient(90deg, #C3DFFF, #2EA7F5)` | Section accents |

Font: the site uses **Arboria**, a licensed Adobe Fonts typeface, so we don't
ship it. Decision: replace Geist with **Plus Jakarta Sans** (variable). It is a
geometric sans close in feel to Arboria, but it was designed for product UI. It
stays readable at 12–14px in dense tables and rows, has a wide weight range for
the hero/H1 to body hierarchy, and is OFL-licensed and self-hosted through
fontsource, so there is no external font CDN. Pair it with **JetBrains Mono**
(variable) for checksums, version strings and install commands.

## Phase 1 — Design tokens (`client/src/index.css`)

Everything downstream reads shadcn CSS variables, so most of the change happens
here.

**Light (`:root`)**, blue-tinted rather than pure white:

| Token                   | New value                           |
| ----------------------- | ----------------------------------- |
| `--background`          | `#F0F9FF` blended toward white, e.g. `oklch(0.975 0.012 240)` |
| `--foreground`          | navy-black `oklch(0.24 0.06 260)` (`#0F3678` family) |
| `--card` / `--popover`  | `#FFFFFF` (cards float on the tinted page) |
| `--primary`             | `#0976BC`                           |
| `--primary-foreground`  | `#FFFFFF`                           |
| `--secondary`           | `#DCF1FF`                           |
| `--secondary-foreground`| `#0F3678`                           |
| `--muted`               | `oklch(0.955 0.015 240)`            |
| `--muted-foreground`    | `#6A7FA3`                           |
| `--accent`              | `#DCF1FF`                           |
| `--accent-foreground`   | `#0F3678`                           |
| `--border` / `--input`  | `oklch(0.9 0.025 240)` (blue hairline, between `#DEE1E7` and `#C3DFFF`) |
| `--ring`                | `#2EA7F5`                           |
| `--sidebar`             | `#FFFFFF` (white sidebar, see Phase 2) |
| `--chart-1..5`          | `#0976BC`, `#2EA7F5`, `#6A7FA3`, `#0F3678`, `#93A3BD` |

**Dark (`.dark`)**, navy-based instead of grey:
- background `oklch(0.17 0.04 260)` (deep navy), card `oklch(0.21 0.045 260)`
- primary `#2EA7F5` (the brighter sky blue keeps contrast on navy)
- muted-foreground `#93A3BD`, border `oklch(0.75 0.05 240 / 14%)`

**New brand tokens** (add to `@theme inline` so Tailwind utilities exist):
- `--color-brand-navy`, `--color-brand-sky`, `--color-brand-slate`,
  `--color-brand-ice`, `--color-brand-powder`
- `--shadow-brand: 0 1px 2px oklch(0.3 0.08 250 / 6%), 0 8px 24px -8px oklch(0.45 0.15 245 / 18%)`
- `--gradient-brand: linear-gradient(90deg, #C3DFFF, #2EA7F5)` and
  `--gradient-brand-deep: linear-gradient(135deg, #0F3678, #0976BC 60%, #2EA7F5)`

**Utility classes** (in `@layer components`):
- `.bg-brand-gradient`, `.bg-brand-gradient-deep`
- `.text-brand-gradient` (gradient text for the page H1 accent word)
- `.bg-grid-dots`: a faint radial-dot pattern for hero backgrounds (chip/circuit
  feel, pure CSS)

Acceptance: switching tokens alone, before any component edits, already turns
the app blue/slate in both themes with no contrast regressions. Verify that
`muted-foreground` on `background` passes WCAG AA (4.5:1). `#6A7FA3` on
`#F0F9FF` is borderline, so darken to about `#5A6E92` if it fails.

## Phase 2 — App shell (`components/common/AppShell.tsx`)

- **Sidebar (decided): white with a gradient edge.** Use `bg-sidebar` (white in
  light mode, card-navy in dark mode). Replace the `border-r` with a 3px
  vertical brand-gradient strip on the right edge (an absolutely positioned
  `w-[3px]` div using `bg-[linear-gradient(180deg,#C3DFFF,#2EA7F5,#0976BC)]`).
  In dark mode, keep the same gradient at about 80% opacity so it still glows
  against navy.
- Logo tile: replace the flat `bg-primary` square with `bg-brand-gradient-deep`
  and a soft glow. Add the real Nanoveu/EMASS logo SVG to `src/assets` if one is
  provided.
- Active nav item: left accent bar plus a tinted background. Animate hover with
  `transition-colors duration-200`.
- Header: `bg-background/80 backdrop-blur`, a hairline gradient bottom border
  (`h-px bg-brand-gradient opacity-60`), and a "Customer account" status dot
  with a slow `animate-pulse`.
- Avatar: gradient ring (`ring-2 ring-brand-powder`).

## Phase 3 — Catalog page (`pages/Catalog/*`)

- **Page header to welcome banner:** wrap the H1 block in a rounded panel with
  `bg-brand-gradient-deep`, the `bg-grid-dots` overlay, white text and the
  Nanoveu tagline "Smarter, Faster, Greener" as the eyebrow. Add 2–3 stat chips
  inside: SDKs available, latest release date, and "SHA-256 verified". The
  numbers come from `catalog.data.ts`.
- **ProductCard:**
  - Card: `shadow-brand`, `hover:-translate-y-0.5 hover:shadow-lg`,
    `transition-all duration-300`, border `hover:border-primary/40`.
  - Image area: replace the `from-primary/10 via-muted` placeholder with
    `bg-brand-gradient` at low opacity plus the dot grid. Slow image zoom on
    hover (`group-hover:scale-105 duration-500`).
  - Version badge: pill `bg-secondary text-secondary-foreground` with a
    `Published` green dot.
  - Download button: primary, with the icon nudging down on hover
    (`group-hover/btn:translate-y-0.5`).
- **Support block:** tinted `bg-secondary/60` panel with a sky-blue icon tile,
  replacing the grey `bg-muted/30`.
- **Entrance motion:** stagger cards with
  `animate-in fade-in slide-in-from-bottom-2` plus inline
  `animation-delay` (from `tw-animate-css`, already installed).

## Phase 4 — Product details (`pages/ProductDetails/*`)

- **ProductHero:** change the overlay from `from-black/70` to
  `from-brand-navy/90 via-brand-navy/30`, so the hero tints blue instead of
  black. Give the "Latest stable" chip a `bg-white/15` glass look with an
  emerald dot.
- **LatestRelease:** highlight with a 2px gradient top border (or a
  gradient-bordered card) so it stands apart from previous versions.
- **ReleaseFileRow:**
  - Icon tile `bg-secondary text-primary` instead of grey.
  - Row hover: `hover:border-primary/40 hover:bg-secondary/30`.
  - **Show the SHA-256 next to each file.** This is a fixed decision in
    AGENTS.md and the current row omits it. Use a truncated monospace hash
    with a copy button and a tooltip for the full value. The type currently
    holds `checksum` per *release*. The backend stores it per *file*, so move
    `checksum` onto `ReleaseFile` in `catalog.types.ts` and
    `catalog.data.ts`.
- **PreviousReleases:** use a slate `Archived` badge (`bg-muted
  text-muted-foreground`) versus the blue/green `Published` badge, so state
  reads at a glance.

## Phase 5 — Shared polish (`components/ui/*`)

Keep shadcn edits minimal. Override only where tokens can't reach:
- `button.tsx`: the default variant gets `shadow-sm shadow-primary/25` and
  `hover:shadow-md`. Add a `brand` variant that uses `bg-brand-gradient-deep`
  for hero CTAs only.
- `card.tsx`: default `shadow-brand` instead of a flat border-only look.
- `sonner.tsx`: success toasts use primary-tinted styling.
- Add a small `StatusBadge` in `components/common/` (Published / Archived /
  Staged) to replace the ad-hoc dot+text spans. Staged appears later for dev
  users.

## Phase 6 — Motion and accessibility guardrails

- All motion is subtle: no more than 300ms, transform/opacity only, no
  parallax, no count-up animations.
- Wrap entrance and hover-lift animations in `motion-safe:` so
  `prefers-reduced-motion` users get a static UI.
- Keep focus rings visible. `--ring` is now sky blue, so check it on the white
  sidebar and cards (light) and on the navy surfaces (dark).
- Re-check contrast for white text on `#0976BC` (passes AA at about 4.9:1) and
  for `#2EA7F5` as dark-mode primary with navy foreground.

## Rollout order and effort

| Step | Files                                   | Est.   |
| ---- | --------------------------------------- | ------ |
| 1    | `index.css` tokens + utilities          | 0.5 d  |
| 2    | `AppShell.tsx`                          | 0.5 d  |
| 3    | Catalog page + `ProductCard`            | 0.5 d  |
| 4    | Product details + checksum-per-file     | 0.5 d  |
| 5    | `ui/*` tweaks, `StatusBadge`            | 0.25 d |
| 6    | A11y/contrast/reduced-motion pass, light+dark QA | 0.25 d |

About 2.5 days in total. Each step is shippable on its own because Phase 1
already delivers most of the visual change.

## Verification

- `npm run lint` and `npm run build` in `client/`.
- Manual QA at 375px, 768px and 1280px, in light and dark themes, on
  `/catalog` and `/catalog/:productId`.
- Run a contrast checker (e.g. axe DevTools) on both pages and both themes.
- Before/after screenshots attached to the PR.

## Decisions (2026-10-17)

1. Sidebar: white, with a gradient strip on the right edge.
2. Font: Plus Jakarta Sans for UI and headings, JetBrains Mono for
   hashes/versions/commands. Geist is removed.
3. Product images: keep the current `imageUrl`s for now. Swapping in official
   imagery is a follow-up.
4. Light and dark themes are both in scope. Every phase is QA'd in both.

## Phase 1 addendum — fonts

- `npm i @fontsource-variable/plus-jakarta-sans @fontsource-variable/jetbrains-mono`
  and `npm uninstall @fontsource-variable/geist`.
- `index.css`: swap the `@import`s. Set `--font-sans: "Plus Jakarta Sans
  Variable", ui-sans-serif, system-ui, sans-serif`, keep `--font-heading:
  var(--font-sans)`, and add `--font-mono: "JetBrains Mono Variable",
  ui-monospace, monospace`.
- Headings use `font-semibold tracking-tight`. Plus Jakarta Sans runs slightly
  wide, so check that the H1 sizes still fit at 375px.
- Apply `font-mono` to checksums, version strings (`v2.4.0`) and the install
  `command` block.

## Risks / assumptions

- Hex values come from nanoveu.com's live CSS (2026-10-17). If Nanoveu has a
  formal brand guide, it overrides these.
- Tinted page backgrounds can make `muted-foreground` text fail AA. Phase 1
  includes the check and the fallback.
- shadcn component edits drift from upstream. Keep them limited to Phase 5.

## Revision: calmer product UI (2026-10-17)

The first pass took the marketing site's decoration along with its identity,
and it felt too loud for a task tool. The rule now is **brand at the edges,
calm in the middle**. "Resemble nanoveu.com" is met through identity: palette,
type, logo and tone. It does not come from decoration.

- **Kept:** colour tokens, fonts, blue primary actions, the sign-in brand panel
  (the one marketing-style moment), navy-tinted product imagery, the
  sidebar gradient edge, and a 2px primary bar on the latest release.
- **Removed:**
  - the catalog gradient hero (now a plain header with one muted stats line)
  - the page background glow and the gradient header hairlines (now plain
    `border-b`)
  - the gradient avatars and logo tiles (now solid primary)
  - card lift and image zoom, the download-icon nudge, all entrance
    animations, and the pulsing dot
  - the `bg-brand-gradient` and `text-brand-gradient` utilities
- **Softened:** `shadow-brand` is a neutral, near-flat shadow, and cards read
  as border-led. `shadow-brand-lg` is used only on the sign-in card.
- **Motion rule:** motion only gives feedback on an action (hover colour,
  focus, press, toast). Nothing animates on page load.
- **Sidebar edge (follow-up):** the gradient edge was also dropped for a plain
  `border-r`, and the `bg-brand-edge` utility was removed. Decision Phase 2 is
  superseded.
- **Follow-up:** get official Nanoveu/EMASS logo SVGs. They are the strongest
  resemblance signal at zero visual cost.
