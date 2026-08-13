# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this project

A single-page application (vanilla JS, no framework, no build step) to track reading progress through Gabriel García Márquez's 18 works. Uses Supabase for cloud persistence and localStorage as offline fallback. All UI text, data and identifiers are in Spanish.

## Running locally

There is no package.json, no build, no linter and no test suite — do not invent commands for them. Serve over HTTP (opening `index.html` via `file://` breaks OAuth, since `redirectTo` is `window.location.origin + pathname`):

```bash
python -m http.server 8000
# or
npx serve
```

The Supabase redirect URL must be whitelisted in the Supabase dashboard for the origin you serve from.

**Only GitHub is enabled as an auth provider.** The Google button exists in the UI but the provider was never configured in the Supabase project, so it returns `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`. Verify a provider before touching the login UI:

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/authorize?provider=google" -H "apikey: <anon-key>"
# 302 → enabled; 400 → not enabled
```

Enabling Google means creating an OAuth client in Google Cloud Console with `https://<project-ref>.supabase.co/auth/v1/callback` as the authorized redirect URI, then pasting the client ID/secret into Supabase → Authentication → Providers. Note that existing reading data is tied to the GitHub-created `user_id`; signing in with a different provider may create a **new** user and show an empty library until the rows are re-pointed.

Verification is manual: load the page in a browser and check the console — the app logs `[Auth]` and `[App]` lifecycle events.

## Architecture

Pure client-side SPA. Scripts load as plain `<script>` tags (**not** ES modules) in this order, declared at the bottom of `index.html`:

```
Chart.js CDN → supabase-js CDN → supabase.js → data.js → charts.js → db.js → auth.js → app.js
```

**Everything shares one global scope.** There are no imports/exports; files communicate through globals:

| Global | Defined in | Consumed by |
|---|---|---|
| `librosOriginales`, `parseFechaEspañol` | `data.js` | `app.js`, `db.js`, `charts.js` |
| `supabaseClient`, `supabaseConfigurado` | `supabase.js` | `auth.js`, `db.js`, `app.js` |
| `usuarioActual` | `auth.js` | `db.js`, `app.js` |
| `libros` (working array) | `app.js` | `app.js`, passed into `charts.js` |
| `window.gaboApp` | `app.js` | `auth.js` (`onLogin` calls back into it) |

Consequences to respect when editing:
- Never add `type="module"`, and never rename a top-level `const`/`function` without grepping the whole `js/` folder — a collision or a rename silently breaks another file.
- `index.html` calls some functions via inline handlers (e.g. `oninput="actualizarDiasModal()"`), so those must stay global.
- `auth.js` ↔ `app.js` is a cyclic relationship broken by `window.gaboApp`: `app.js` calls `inicializarAuth()`, and `auth.js`'s `onLogin` calls `window.gaboApp.cargarDatos()` / `actualizarInterfaz()`.

**File responsibilities:**
- `js/data.js` — Static catalog of the 18 books (`librosOriginales`) plus Spanish date parsing helpers. Source of truth for book metadata.
- `js/supabase.js` — Creates `supabaseClient`. Credentials are hardcoded (anon key only — intentional; `.env.example` is documentation, nothing reads it at runtime).
- `js/auth.js` — OAuth (GitHub & Google), session state, offline mode, login/logout UI swap between `#login-screen` and `.library-layout`.
- `js/db.js` — CRUD against the `lecturas_usuario` table, plus `fusionarConCatalogo()` and `migrarDesdeLocalStorage()`.
- `js/app.js` — All UI logic: state, filters, full re-render, modal, timeline, day calculations, Google Books cover fetching.
- `js/charts.js` — Chart.js doughnut (status) and bar (pages per month) charts. Colors are hardcoded here in a dark palette, not read from CSS variables.

### Startup flow

`DOMContentLoaded` in `app.js`: register listeners once (guarded by `eventListenersInicializados`) → `inicializarAuth()` → if a session exists, migrate localStorage → `cargarDatos()` → `actualizarInterfaz()`; otherwise show the login screen and let `onAuthStateChange(SIGNED_IN)` drive the same path. A `setInterval` then re-runs `actualizarDiasEnProceso()` every 60s.

### Availability — do not regress this

The Supabase free tier **auto-pauses a project after ~7 days of inactivity**, which previously took the whole app down: with the cloud unreachable there was no session, so the user was stuck on the login screen with no way in, and no local copy to fall back on. Four rules now keep the app usable regardless of cloud state — preserve them:

1. `supabase.js` must never throw. It uses `var` + try/catch and sets `supabaseConfigurado = false` on any failure (missing CDN, bad credentials). A thrown error there leaves the globals uninitialized and every later script dies with a ReferenceError.
2. Every Supabase call is wrapped in `conTimeout()` (8s, defined in `auth.js`) and returns a falsy/null result on timeout instead of hanging.
3. If auth init fails or times out, `app.js` calls `entrarModoOffline()` rather than showing the login screen. There is also a manual "Entrar sin conexión" button.
4. localStorage is a **write-through cache, not just a fallback**: `escribirCacheLocal()` runs on every save even while logged in, and `migrarDesdeLocalStorage()` no longer deletes the local copy after migrating.

`charts.js` degrades the same way — if the Chart.js CDN fails, `chartJsDisponible` is false and charts are skipped instead of breaking the book grid.

`modoOffline` (global, `auth.js`) tracks this state and drives the `#offline-banner`.

`.github/workflows/keep-supabase-alive.yml` queries the DB daily so the inactivity counter never reaches 7 days. It **prevents** the pause; it cannot undo one — a paused project answers nothing and must be resumed from the dashboard. Note GitHub disables scheduled workflows after 60 days of repo inactivity, so this is a convenience, not a guarantee: the offline mode above is what actually keeps the app usable.

## Data model — the critical invariant

`libro_id` is the **0-based array index into `librosOriginales`**, not a stable ID. The DB stores only user progress; title/year/pages/summary always come from the local catalog via `fusionarConCatalogo()`.

**Therefore: never reorder, insert into the middle of, or remove entries from `librosOriginales`.** Doing so silently reassigns every existing user's saved progress to the wrong books. Only append at the end. Introducing a real stable key would require a data migration.

## Persistence

Both write paths write localStorage (`gaboLecturas` key) **first**, then push to Supabase when a session exists:
- `guardarLectura(index)` → single-row upsert. Used for all normal edits.
- `guardarDatos()` → batch upsert of all 18 rows. Used after bulk cover fetching and after an import.

Upserts use `onConflict: 'user_id,libro_id'`, matching the unique constraint in `supabase-schema.sql`. On first login `migrarDesdeLocalStorage()` copies local data up **only if the user has no DB rows yet**.

`exportarDatos()` / `importarDatos()` write and read a versioned JSON backup (`{version, exportado, libros:[{libro_id, …}]}`) — the only copy that survives both a paused project and a cleared browser. Import takes progress fields only; metadata always comes from the local catalog.

Note `resetearDatos()` only clears localStorage and reloads — it does **not** delete Supabase rows, so it has no effect for a logged-in user.

## State transitions

Reading state is never changed by the edit form. `guardarEdicion()` saves only the two dates; `estado` changes go exclusively through `cambiarEstadoRapido()` (card hover buttons and modal action buttons), which auto-fills dates: `Leyendo` sets `inicio` to today if empty, `Leído` fills both, `Pendiente` clears both and nulls `dias`.

Day counts derive from state: `Leído` → `final - inicio`; `Leyendo` → `today - inicio` (recomputed each minute); `Pendiente` → `null`. Negative results become `null`.

## Database schema

Table `lecturas_usuario` (see `supabase-schema.sql`, applied by pasting into the Supabase SQL editor). Columns: `user_id`, `libro_id`, `estado` (`'Leído'|'Leyendo'|'Pendiente'`, CHECK-constrained), `inicio`/`final` (Spanish date **strings**, not DATE), `dias`, `portada` (cached Google Books URL), `comentarios`. Unique on `(user_id, libro_id)`; RLS restricts every operation to `auth.uid() = user_id`.

## Date format

All dates are stored and parsed as Spanish strings: `DD/mes/YYYY` (e.g. `15/marzo/2024`). Month names are Spanish only — any date logic must go through `parseFechaEspañol()`. Two formatters exist and differ: `formatFechaEspañol()` in `data.js` (no zero-padding) vs `formatearFechaEspañol()` in `app.js` (zero-padded, and the one actually used). Prefer the `app.js` one for anything written back to storage.

Source files contain accented identifiers (`año`, `parseFechaEspañol`, `mesesEspañol`) — keep files UTF-8.

## CSS

`css/styles.css` holds the design system (CSS custom properties) and layout; `css/animations.css` holds keyframes and motion, including a `prefers-reduced-motion` block. Responsive breakpoints: >1024px (3-col grid), 768–1024px (2-col), <768px (1-col, sidebar becomes an overlay drawer toggled by `#mobile-menu-btn`).

## Rendering

`renderizarLibros()` wipes and rebuilds `#books-grid` on every change (18 items — cheap, no diffing). Filtering produces a subset, and each card stores the **original** index via `libros.indexOf(libro)` in `data-index`; that index is what every save path uses, so keep it intact when touching card creation.

`README.md` is stale in places (it says 17 books and lists a `butterflies.js` that no longer exists) — trust the code over the README.
