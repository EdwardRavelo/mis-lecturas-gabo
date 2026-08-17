# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this project

A single-page application (vanilla JS, no framework, no build step) to track reading progress. It began as a static catalogue of Gabriel García Márquez's 18 works and is now a **general reading diary organised by theme**: every entry belongs to a user-created *tema* (with its own accent colour) and an optional free-text *subtema*, and can be a book, a course, documentation, a video, a film or an article (`tipo`). Roughly 112 entries live in the database today — the original 18 GGM works plus 94 loaded from a spreadsheet by `supabase-schema-v3.sql`.

Data lives in Supabase, with localStorage as a write-through cache. All UI text, data and identifiers are in Spanish.

## Running locally

There is no package.json, no build, no linter and no test suite — do not invent commands for them. Serve over HTTP (opening `index.html` via `file://` breaks OAuth, since `redirectTo` is `window.location.origin + pathname`):

```bash
node servidor.js            # sirve la carpeta actual en :8000
node servidor.js . 8080     # otra carpeta / otro puerto
```

`servidor.js` is a dependency-free static server that sends `Cache-Control: no-store`, so a reload always shows your edits. `python -m http.server` or `npx serve` work too, but they cache.

The Supabase redirect URL must be whitelisted in the Supabase dashboard for the origin you serve from.

**Only GitHub is enabled as an auth provider.** The Google button exists in the UI but the provider was never configured in the Supabase project, so it returns `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`. Verify a provider before touching the login UI:

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/authorize?provider=google" -H "apikey: <anon-key>"
# 302 → enabled; 400 → not enabled
```

Enabling Google means creating an OAuth client in Google Cloud Console with `https://<project-ref>.supabase.co/auth/v1/callback` as the authorized redirect URI, then pasting the client ID/secret into Supabase → Authentication → Providers. Note that existing reading data is tied to the GitHub-created `user_id`; signing in with a different provider creates a **new** user and shows an empty library until the rows are re-pointed.

Verification is manual: load the page in a browser and check the console — the app logs `[Auth]` and `[App]` lifecycle events.

## Architecture

Pure client-side SPA. Scripts load as plain `<script>` tags (**not** ES modules) in this order, declared at the bottom of `index.html`:

```
Chart.js CDN → supabase-js CDN → supabase.js → data.js → charts.js → db.js → auth.js → app.js
```

**Everything shares one global scope.** There are no imports/exports; files communicate through globals:

| Global | Defined in | Consumed by |
|---|---|---|
| `parseFechaEspañol`, `formatearFechaEspañol`, `fechaIsoAEspañol`, `fechaEspañolAIso` | `data.js` | `app.js`, `db.js`, `charts.js` |
| `supabaseClient`, `supabaseConfigurado` | `supabase.js` | `auth.js`, `db.js`, `app.js` |
| `usuarioActual`, `modoOffline`, `conTimeout` | `auth.js` | `db.js`, `app.js` |
| `temas`, `libros`, `temaActual` (working state) | `app.js` | `app.js`, passed into `charts.js` |
| `window.gaboApp` | `app.js` | `auth.js` (`onLogin` calls back into it) |

Consequences to respect when editing:
- Never add `type="module"`, and never rename a top-level `const`/`function` without grepping the whole `js/` folder — a collision or a rename silently breaks another file.
- `index.html` calls some functions via inline handlers (e.g. `oninput="actualizarDiasModal()"`), so those must stay global.
- `auth.js` ↔ `app.js` is a cyclic relationship broken by `window.gaboApp`: `app.js` calls `inicializarAuth()`, and `auth.js`'s `onLogin` calls `window.gaboApp.cargarDatos()` / `actualizarInterfaz()`.

**File responsibilities:**
- `js/data.js` — **Date handling only.** The static catalogue (`librosOriginales`) was removed in schema v2; the books now live in Supabase. Holds the Spanish month map and the four date functions.
- `js/supabase.js` — Creates `supabaseClient`. Credentials are hardcoded (anon key only — intentional; RLS is what protects the data. `.env.example` is documentation, nothing reads it at runtime).
- `js/auth.js` — OAuth, session state, offline mode, login/logout UI swap between `#login-screen` and `.library-layout`. Defines `conTimeout()`.
- `js/db.js` — CRUD for `temas` and `libros`, plus the DB↔app translation (`libroDesdeDB` / `libroParaDB`).
- `js/app.js` — All UI logic: state, theme selection, filters, re-render, the three modals, timeline, day calculations, Google Books cover fetching.
- `js/charts.js` — Two visualisations (see below).

### Startup flow

`DOMContentLoaded` in `app.js`: register listeners once (guarded by `eventListenersInicializados`) → `inicializarAuth()` → if a session exists, `cargarDatos()` → `actualizarInterfaz()`; otherwise show the login screen and let `onAuthStateChange(SIGNED_IN)` drive the same path. A `setInterval` then re-runs `actualizarDiasEnProceso()` every 60s.

`cargarDatos()` loads `temas` and `libros` **in parallel** (`Promise.all`) and only accepts the result if *both* succeeded; otherwise it falls back to the local cache.

### Availability — do not regress this

The Supabase free tier **auto-pauses a project after ~7 days of inactivity**, which previously took the whole app down: with the cloud unreachable there was no session, so the user was stuck on the login screen with no way in, and no local copy to fall back on. Four rules keep the app usable regardless of cloud state — preserve them:

1. `supabase.js` must never throw. It uses `var` + try/catch and sets `supabaseConfigurado = false` on any failure (missing CDN, bad credentials). A thrown error there leaves the globals uninitialized and every later script dies with a ReferenceError.
2. Every Supabase call is wrapped in `conTimeout()` (8s, defined in `auth.js`) and returns a falsy/null result on timeout instead of hanging. `db.js` states this as its "regla de oro": no function there may throw or hang.
3. If auth init fails or times out, `app.js` calls `entrarModoOffline()` rather than showing the login screen. There is also a manual "Entrar sin conexión" button.
4. localStorage is a **write-through cache, not just a fallback**: `escribirCacheLocal()` runs on every save even while logged in.

`charts.js` degrades the same way — if the Chart.js CDN fails, `chartJsDisponible` is false and the bar chart is skipped instead of breaking the grid. The stacked status bar is plain HTML and works regardless.

`modoOffline` (global, `auth.js`) tracks this state and drives the `#offline-banner`.

Offline you can read and edit progress, but **not** create/edit/delete themes or books: `puedeEditarCatalogo()` gates those on having a session, because they need a server-generated UUID.

`.github/workflows/keep-supabase-alive.yml` queries the DB daily so the inactivity counter never reaches 7 days. It **prevents** the pause; it cannot undo one — a paused project answers nothing and must be resumed from the dashboard. GitHub also disables scheduled workflows after 60 days of repo inactivity, so this is a convenience, not a guarantee: the offline mode above is what actually keeps the app usable.

## Data model

Two tables, both scoped by `user_id` with RLS (`auth.uid() = user_id`):

```
temas    id · user_id · nombre · color · orden            UNIQUE (user_id, nombre)
libros   id · user_id · tema_id → temas.id ON DELETE SET NULL
         subtema · titulo · autor · anio · paginas · resumen · portada · tipo · enlace
         estado · inicio · final · dias · comentarios · orden
```

Key points:

- **`id` is a server-generated UUID.** This replaced the old `libro_id`, which was a 0-based index into the static catalogue and made reordering the array corrupt everyone's progress. That hazard is gone: ids are stable, and `crearLibroDB()` must return before the book exists in memory.
- Metadata and progress live in the **same row**, so nothing is merged on load. There is no `fusionarConCatalogo()` any more.
- Deleting a theme does **not** delete its books (`ON DELETE SET NULL`); they fall into the virtual "Sin tema" bucket. `borrarTema()` says so in the confirmation.
- `subtema` is free text, not a table. `renderizarLibros()` groups by it, and the book form offers a `<datalist>` of existing values so you don't end up with "Básico" and "basico" as two groups.
- `temaActual` is tri-state: `null` = all themes, `'sin-tema'` = orphans, otherwise a theme UUID.

Schema files are cumulative, applied by pasting into the Supabase SQL editor: `supabase-schema.sql` (v1, the old `lecturas_usuario` table), `supabase-schema-v2.sql` (temas + libros), `supabase-schema-v3.sql` (adds `subtema`/`tipo`/`enlace` and loads 94 rows). **v3 is idempotent** — it re-runs without duplicating, matching on title within a theme.

## Dates — the conversion boundary

Two representations coexist:

- **Database** → `DATE` in ISO: `'2026-02-24'`
- **In memory / UI** → Spanish string: `'24/febrero/2026'`

The app works in the Spanish format because `calcularDias()`, the charts and the modal all depend on it. Translation happens in `db.js` and **only** there, via `libroDesdeDB()` / `libroParaDB()`.

Conversion is done with **strings, never `Date`**: `new Date('2026-02-24')` parses as UTC midnight and in negative offsets returns the previous day. A one-day drift in reading dates is exactly the kind of bug that goes unnoticed for months.

`libroParaDB()` also maps the column `anio` (no ñ, to avoid SQL trouble) to `año`, which is what the whole UI uses. `actualizarLibroDB()` sends **only the keys the caller actually passed**, so a partial update doesn't null out untouched columns — note it checks `equivalente in campos`, so that mapping matters.

Source files contain accented identifiers (`año`, `parseFechaEspañol`) — keep files UTF-8.

## Persistence

`persistirLibro(libro, campos)` is the single write path for reading progress: it assigns the fields, recalculates `dias`, writes the local cache, then pushes to Supabase. Catalogue edits (create/update/delete of books and themes) go through the `*DB()` functions in `db.js` and then update the in-memory arrays.

The local cache key is `gaboLecturas` and holds `{temas, libros}`. `leerCacheLocal()` **discards a bare array**, which is the pre-v2 format (18 catalogue books) — it would otherwise load as books with no ids.

`exportarDatos()` / `importarDatos()` handle a versioned JSON backup (`version: 2`). Import restores *progress only*, matching by normalised title, and reports which titles it couldn't find; it never creates books. Bulk creation is the CSV/SQL importer's job (`crearLibrosDB`).

## State transitions

Reading state is never changed by the date form. `guardarEdicion()` saves only the two dates; `estado` changes go exclusively through `cambiarEstadoRapido()` (card hover buttons and modal action buttons), which auto-fills dates: `Leyendo` sets `inicio` to today if empty, `Leído` fills both, `Pendiente` clears both.

Day counts derive from state: `Leído` → `final - inicio`; `Leyendo` → `today - inicio` (recomputed each minute); `Pendiente` → `null`. Negative results become `null`.

## Design system and layout

`css/styles.css` holds the tokens and layout; `css/animations.css` holds keyframes and a `prefers-reduced-motion` block.

The system is **"Papel y tinta"**: raw-paper surfaces and warm near-black ink, editorial typography (Fraunces for headings, DM Sans for data), small radii and no decoration that costs space. Identity no longer hangs off any one author — the accent colour is supplied per theme, injected by `aplicarColorTema()` as `--tema-acento` on `:root`.

**Every colour lives in the `:root` block.** Nothing downstream repeats a hex — not the rest of the CSS, not `js/charts.js`, which reads tokens via `token()`. Retheming means rewriting that block and nothing else.

**The three status colours (`--leido`, `--leyendo`, `--pendiente`) are validated** for contrast and colour-blindness with the `dataviz` skill's validator, `--pairs all` (the three coexist in the stacked status bar). Worst pair `#B57C00` ↔ `#007551`: ΔE 10.4 protanopia, 21.1 normal vision; all checks PASS. **Do not change those hex values without re-running the validator.**

That validation is **against a light surface**. The previous palette was validated against `#171613` and could not be carried over when the theme went to paper — its green and grey collapsed to ΔE 5.2 under protanopia. If the theme ever goes dark again, re-run the process; do not invert the values.

The per-theme accent is user data and is **not** validated: a light theme colour will read weakly as text on paper. Themes are editable from the UI, so the fix is to change the theme's colour, not to hardcode an override.

**The app is a 100dvh shell and the page never scrolls.** `body` is `overflow: hidden`; `.library-layout` is `height: 100dvh`. Only the sidebar, `#books-grid` and the modal body scroll. Consequences:

- `.library-layout` must keep working as **flex** — `auth.js` sets `appLayout.style.display = 'flex'` inline when hiding the login screen, which would override a `display: grid`.
- `.books-section` needs `min-height: 0`; without it a flex child refuses to shrink below its content and the whole shell overflows.
- Horizontal padding lives on each block (`.section-header`, `.books-grid`, `.analysis-toggle`, `.tabs`, `.tab-content`), **not** on `.main-content` — a scrolling container would otherwise clip inside its own margin. Every breakpoint has to move all of them together.
- `.mobile-header` sits outside `.library-layout`, so under 768px the shell is `calc(100dvh - 48px)`. That 48px is fixed in CSS on purpose.

The analysis panel (`#analysis-section`) is **collapsed by default**, toggled by `#analysis-toggle` flipping an `.open` class. Chart.js measures its container at construction time and a hidden container measures 0, so `app.js` re-runs `initCharts(librosDelTema())` both when the panel opens and when the "Análisis" tab is selected. Keep those calls.

Breakpoints: >1024px full shell, ≤1024px narrower sidebar and single-column modal, ≤768px sidebar becomes an overlay drawer, ≤480px the progress strip and secondary actions wrap.

## Visualisations

Two pieces, each with the form its data calls for (`charts.js` documents the reasoning):

- **Reparto por estado** — part-to-whole → **stacked bar in plain HTML**, not a doughnut: a ring forces angle comparison and wastes a narrow column. Legend always carries name *and* value, so identity never depends on colour alone.
- **Páginas por mes** — magnitude over time → Chart.js bars, one series and therefore one colour.

Both are scoped to `librosDelTema()`, not to all books. When there is nothing to show they say so, instead of drawing an empty chart with a fake "Sin datos" label.

## Rendering

`renderizarLibros()` wipes and rebuilds `#books-grid` on every change. If any visible book has a `subtema`, the grid switches to `.agrupado` mode: a stack of `<section>`s, each with its own inner grid so cards align **within** their group rather than across groups. Cards carry `data-id` (the UUID) and look the book up by id — there is no index bookkeeping.

`renderizarTimeline()` is a chronology of **reading**, newest first, and skips entries with no dates: that is what makes the app a diary rather than a bibliography.

All user-supplied text goes through `escaparHtml()` before being interpolated into `innerHTML`. Keep it that way — titles, authors and subtemas are free text.

`actualizarInterfaz()` also calls `cargarTodasLasPortadas()`, which hits Google Books for every book lacking a `portada` and persists what it finds. It skips immediately when nothing is missing.
