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
three.min.js CDN → OrbitControls CDN → supabase-js CDN
  → supabase.js → data.js → estante3d.js → db.js → auth.js → app.js
```

**Everything shares one global scope.** There are no imports/exports; files communicate through globals:

| Global | Defined in | Consumed by |
|---|---|---|
| `parseFechaEspañol`, `formatearFechaEspañol`, `fechaIsoAEspañol`, `fechaEspañolAIso` | `data.js` | `app.js`, `db.js` |
| `supabaseClient`, `supabaseConfigurado` | `supabase.js` | `auth.js`, `db.js`, `app.js` |
| `usuarioActual`, `modoOffline`, `conTimeout` | `auth.js` | `db.js`, `app.js` |
| `temas`, `libros`, `filtroActual` (working state) | `app.js` | `app.js`, passed into `estante3d.js` |
| `window.gaboApp` | `app.js` | `auth.js` (`onLogin` calls back into it) |
| `token` | `estante3d.js` | `estante3d.js`, `app.js` |
| `estanteDisponible`, `montarMuro`, `desmontarMuro`, `montarEstanteModal`, `desmontarEstanteModal`, `enfocarLibroEnMuro`, `enfocarLibroEnModal` | `estante3d.js` | `app.js` |

Consequences to respect when editing:
- Never add `type="module"`, and never rename a top-level `const`/`function` without grepping the whole `js/` folder — a collision or a rename silently breaks another file.
- `index.html` calls some functions via inline handlers (e.g. `oninput="actualizarDiasModal()"`), so those must stay global.
- `auth.js` ↔ `app.js` is a cyclic relationship broken by `window.gaboApp`: `app.js` calls `inicializarAuth()`, and `auth.js`'s `onLogin` calls `window.gaboApp.cargarDatos()` / `actualizarInterfaz()`.

**File responsibilities:**
- `js/data.js` — **Date handling only.** The static catalogue (`librosOriginales`) was removed in schema v2; the books now live in Supabase. Holds the Spanish month map and the four date functions.
- `js/supabase.js` — Creates `supabaseClient`. Credentials are hardcoded (anon key only — intentional; RLS is what protects the data. `.env.example` is documentation, nothing reads it at runtime).
- `js/auth.js` — OAuth, session state, offline mode, login/logout UI swap between `#login-screen` and `.library-layout`. Defines `conTimeout()`.
- `js/db.js` — CRUD for `temas` and `libros`, plus the DB↔app translation (`libroDesdeDB` / `libroParaDB`).
- `js/app.js` — All UI logic: state, filters, re-render, the `···` menu, the five modals (reading detail, theme form, book form, bulk table, shelf), day calculations, Google Books cover fetching. Also the shelf's DOM half: grouping into shelves, the legend, the accessible mirror and the flat fallback.
- `js/estante3d.js` — The WebGL half of the shelf (see "The 3D shelf"). Also defines `token()`, which reads colours out of `:root`; it lived in `js/charts.js` until that file went with the charts. Loads before `app.js`, which calls into both.

### Startup flow

`DOMContentLoaded` in `app.js`: register listeners once (guarded by `eventListenersInicializados`) → `inicializarAuth()` → if a session exists, `cargarDatos()` → `actualizarInterfaz()`; otherwise show the login screen and let `onAuthStateChange(SIGNED_IN)` drive the same path. A `setInterval` then re-runs `actualizarDiasEnProceso()` every 60s.

`cargarDatos()` loads `temas` and `libros` **in parallel** (`Promise.all`) and only accepts the result if *both* succeeded; otherwise it falls back to the local cache.

### Availability — do not regress this

The Supabase free tier **auto-pauses a project after ~7 days of inactivity**, which previously took the whole app down: with the cloud unreachable there was no session, so the user was stuck on the login screen with no way in, and no local copy to fall back on. Four rules keep the app usable regardless of cloud state — preserve them:

1. `supabase.js` must never throw. It uses `var` + try/catch and sets `supabaseConfigurado = false` on any failure (missing CDN, bad credentials). A thrown error there leaves the globals uninitialized and every later script dies with a ReferenceError.
2. Every Supabase call is wrapped in `conTimeout()` (8s, defined in `auth.js`) and returns a falsy/null result on timeout instead of hanging. `db.js` states this as its "regla de oro": no function there may throw or hang.
3. If auth init fails or times out, `app.js` calls `entrarModoOffline()` rather than showing the login screen. There is also a manual "Entrar sin conexión" button.
4. localStorage is a **write-through cache, not just a fallback**: `escribirCacheLocal()` runs on every save even while logged in.

`estante3d.js` degrades the same way — if the Three.js CDN fails or the browser gives no WebGL context, `estanteDisponible` is false and `app.js` paints a flat HTML shelf instead of breaking the page. That pattern came from `charts.js`, which guarded Chart.js the same way before the charts were removed.

`modoOffline` (global, `auth.js`) tracks this state and drives the `#offline-banner`.

Offline you can read and edit progress, but **not** create/edit/delete themes or books: `puedeEditarCatalogo()` gates those on having a session, because they need a server-generated UUID.

`.github/workflows/keep-supabase-alive.yml` queries the DB daily so the inactivity counter never reaches 7 days. It hits **`lecturas_usuario`**, the v1 table, without a session: RLS returns an empty list, but Postgres still saw the query, which is what counts as activity — so `supabase-schema.sql` has to stay applied even though no other code reads that table. It **prevents** the pause; it cannot undo one — a paused project answers nothing and must be resumed from the dashboard. GitHub also disables scheduled workflows after 60 days of repo inactivity, so this is a convenience, not a guarantee: the offline mode above is what actually keeps the app usable.

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

`exportarDatos()` / `importarDatos()` handle a versioned JSON backup (`version: 2`). Import restores *progress only*, matching by normalised title, and reports which titles it couldn't find; it never creates books — that is what the bulk table does.

### Bulk entry (`#lote-modal`)

`abrirModalLote()` builds an editable table (`LOTE_COLUMNAS`: titulo · autor · tipo · año · paginas · enlace); one theme and one subtema apply to the whole batch, defaulting to the theme you are looking at. `actualizarResumenLote()` runs on every keystroke and marks rows whose normalised title already exists (in the library or earlier in the table) with `.lote-repetida`; those are **skipped, not rejected**, and the submit button shows how many rows will actually be created. `crearLoteLecturas()` sends the survivors through `crearLibrosDB()` — one `insert().select()` — and on failure leaves the table intact to retry. Everything lands as `Pendiente` with no dates. Gated by `puedeEditarCatalogo()`, like every other catalogue edit. This replaced the spreadsheet→SQL route that produced `supabase-schema-v3.sql`.

## State transitions

Reading state is never changed by the date form. `guardarEdicion()` saves only the two dates; `estado` changes go exclusively through `cambiarEstadoRapido()` (card hover buttons and modal action buttons), which auto-fills dates: `Leyendo` sets `inicio` to today if empty, `Leído` fills both, `Pendiente` clears both.

Day counts derive from state: `Leído` → `final - inicio`; `Leyendo` → `today - inicio` (recomputed each minute); `Pendiente` → `null`. Negative results become `null`.

## Design system and layout

`css/styles.css` holds the tokens and layout; `css/animations.css` holds keyframes and a `prefers-reduced-motion` block; `css/estante.css` holds the shelf's chrome.

The system is **"Biblioteca"**: dark walnut surfaces, warm off-white ink, brass accents and lamp light. Display type is **Instrument Serif**, data and UI **Plus Jakarta Sans**. It replaced *"Papel y tinta"* (raw paper, warm near-black ink, Fraunces + DM Sans) in the redesign of 2026-09-16. The reason is physical rather than fashionable: the centrepiece of the app is now a lit 3D bookcase, and a pale page around a dark scene fights itself. Identity does not hang off any one author — the accent colour is supplied per theme, injected by `aplicarColorTema()` as `--tema-acento` on `:root`.

**Every colour lives in the `:root` block**, and `js/estante3d.js` reads it from there via `token()` — so the palette reaches the WebGL scene on its own as long as that convention holds. Retheming is mostly rewriting that one block, but four places still carry a literal colour and a retheme has to sweep them:

- `index.html` line 7 — the favicon is an inline SVG data URI with the palette baked in. Easiest one to forget, and it shows in the tab.
- `index.html` `#tema-color` — the default accent offered when creating a theme.
- `js/app.js` `abrirModalTema()` — the same default, applied when editing a theme with no colour.
- `js/estante3d.js` — every `token()` call passes the current value as its fallback. Only fires if the token is missing, but stale values here silently outlive a retheme.
- `css/styles.css` `.btn-primary:hover` / `.login-btn-github:hover` — were two raw `#000`; now tokens, but the pattern recurs.

`:root` still carries an `-rgb` copy of each status colour (`--leido-rgb` and friends). Nothing uses them since the list view went, but they cost nothing and the next `rgba()` that needs a status colour will want them.

**The three status colours (`--leido`, `--leyendo`, `--pendiente`) are validated** for contrast and colour-blindness with the `dataviz` skill's validator, `--pairs all` (the three coexist in the stacked status bar), against **both** surfaces they appear on, `#211A14` and `#17120E`:

```bash
node <dataviz>/scripts/validate_palette.js "#2FA377,#BE831C,#8676E0" --mode dark --surface "#211A14" --pairs all
```

Worst pair `#BE831C` ↔ `#2FA377`: ΔE 9.8 protanopia, 17.6 normal vision; all checks PASS. **Do not change those hex values without re-running the validator.**

That validation is **against a dark surface**, and the dark band is narrower than the light one (OKLCH L 0.48–0.67 versus 0.43–0.77). This palette was *rebuilt*, not converted: the previous one was validated on paper and every candidate that simply darkened it failed the lightness band. The lesson has now been paid for twice — when the surface changes, re-run the process and re-step the colours; never invert or nudge the old ones.

The per-theme accent is user data and is **not** validated: a dark theme colour will read weakly against the walnut. Themes are editable from the UI, so the fix is to change the theme's colour, not to hardcode an override.

**The app is a 100dvh shell and the page never scrolls.** `body` is `overflow: hidden`; `.library-layout` is `height: 100dvh`. Only `#estante-raiz`, the menu panel and the modal bodies scroll. Consequences:

- `.library-layout` must keep working as **flex** — `auth.js` sets `appLayout.style.display = 'flex'` inline when hiding the login screen, which would override a `display: grid`.
- `.books-section` needs `min-height: 0`; without it a flex child refuses to shrink below its content and the whole shell overflows.
- Padding lives on `#estante-raiz`, **not** on `.main-content` — a scrolling container would otherwise clip inside its own margin. This used to mean moving five blocks together at every breakpoint; with the sidebar and the grid gone there is only the one.
- `.mobile-header` sits outside `.library-layout`, so under 768px the shell is `calc(100dvh - 48px)`. That 48px is fixed in CSS on purpose.

A hidden container measures 0, and a camera built against it comes out with a nonsensical aspect ratio. That is why `abrirEstante()` adds `.active` to the modal **before** mounting the scene. The analysis panel taught this lesson first, with Chart.js; the panel is gone but the rule outlived it.

Breakpoints: ≤1024px tighter shell padding and single-column modal, ≤768px the menu panel spans the width and modals dock to the bottom, ≤480px the filter grid and the progress strip stack. The shelf has its own cuts in `css/estante.css`.

## The 3D shelf

The signature component, and since the cut of 2026-09-26 the **only** view: no card grid, no list, no view switcher. It is split in two halves:

- `js/estante3d.js` — everything WebGL: scene, meshes, textures, raycasting, disposal.
- `js/app.js` — everything DOM: grouping into shelves (`baldasDesde()`), the legend, the accessible mirror, the flat fallback and the shelf modal (`abrirEstante()` / `cerrarEstante()`).

**The wall** shows one plank per theme, built from the books left after `filtroActual` and the search box — both of which now live in the `···` menu. Orphans (no `tema_id`) get the virtual `'sin-tema'` shelf at the end. Clicking a plank opens `#estante-modal`; clicking a book opens the existing `#edit-modal` through `abrirModalEdicion()`.

**The modal** rebuilds the same furniture for one theme, one plank per `subtema`, splitting a long subtema across several planks (only the first is labelled). Its books carry title and author rasterised on the spine; the wall's do not.

### Six things here that are load-bearing

1. **Three.js is pinned to r147, and that is deliberate.** It is the last release with a UMD build *and* a non-modular `examples/js/`. It publishes `THREE` as a global, so the "never add `type="module"`" rule survives untouched. Upgrading means either an import map or a bundler — i.e. dismantling the architecture this whole file describes.

2. **`renderizarLibros()` calls `desmontarMuro()` before it touches the DOM.** The canvas lives inside `#estante-raiz`, which gets wiped on every change. Without the teardown, every re-render orphans a canvas with a live WebGL context, and browsers only allow ~16. `destruir()` frees geometries, materials, textures and the renderer itself — except `GEOM_CAJA`, the unit box shared by every mesh in every mount; disposing that one would leave the *next* shelf with no geometry.

3. **The canvas is `position: absolute` inside a container with a definite height.** This is structural, not cosmetic: it makes it impossible for the canvas to grow its parent and re-trigger the `ResizeObserver`. That exact feedback loop already ate the pages chart once (see "Visualisations"); here it is designed out rather than tuned around.

4. **There is no render loop.** Frames are drawn on demand — on hover, on a tween, on a camera change — and the tween stops itself when nothing is still moving. A reading diary has no business holding a GPU at 60fps.

5. **Never two live scenes.** Opening the shelf modal calls `desmontarMuro()` first, and closing it calls `renderizarLibros()` to put the wall back. This is not tidiness: a browser allows on the order of 16 simultaneous WebGL contexts and, when you exceed that, it kills the **oldest** — which is the wall's. Opening and closing shelves quickly left the furniture behind the modal permanently black. With one scene at a time it cannot happen, and the covered wall stops holding video memory.

6. **`estanteDisponible` is the kill switch**, false when `THREE` is missing or the browser gives no WebGL context. `montarMuro()` / `montarEstanteModal()` then return false and `app.js` paints `crearEstantePlano()` instead — the same spines, flat, fully usable. The availability rules in this file are technical, not aesthetic: the redesign lifted the visual invariants, not the rule that the app survives a dead CDN.

### Accessibility is not optional here

A `<canvas>` is opaque to the keyboard, to screen readers and to Ctrl+F, and the theme and subtema names are **painted into textures**, so they do not exist as text anywhere else. `crearEspejoEstante()` renders the whole piece of furniture as real DOM — a visually-hidden but focusable list of buttons in the same order. Tab walks the books, focus pulls out the matching 3D book (`enfocarLibroEnMuro` / `enfocarLibroEnModal`), Enter opens the detail. It is clipped with `clip-path`, never `display: none`, which would take it out of the tab order — the whole point.

The status colours are the only signal on a wall spine, so the DOM legend above the canvas always carries **name and count**, never colour alone.

Wall spines also carry no text — at 16px wide none would be legible, and it would mean 112 textures to say nothing. What a book *is* comes from `mostrarPista()`, a DOM tooltip fed by the same raycast that drives the hover. It is positioned with `transform`, not `top`/`left`, so the browser does not re-layout on every mouse move, and it flips to the other side of the cursor near a window edge.

### Geometry, and why it is deterministic

Spine thickness comes from `paginas` (1.15 when null, which is most of the catalogue). Height and hue jitter come from `hashEstante(id)` — a hash, never `Math.random()`, because `renderizarLibros()` rebuilds the furniture on every filter keystroke and random heights would make the books dance. Spine height is capped at 18.5 against a 28-unit back panel: the top third is reserved for the shelf label, and raising the cap puts the tallest book through the theme's name.

The label sits on the **back panel**, not on the plank edge where a real shelf would carry it. The plank edge is 1.7 units against 74 of width — about twelve screen pixels — and nothing legible fits there.

State shows as a **tejuelo**: the shelfmark label a library glues to the foot of a spine — matte, bordered, with a dot in the state colour. It replaced a saturated band across the whole lower spine that read as a fluorescent sticker. The dot is deliberately large: in the wall it is the only per-book state signal there is, and at 16px of spine width a subtle one disappears.

## Rendering

There is exactly one view. `renderizarLibros()` tears down the 3D wall, filters `libros` by `filtroActual` and the search box, and hands the survivors to `renderizarEstante()`. That is the whole render path — no card grid, no list mode, no `vistaActual`.

`actualizarInterfaz()` is now two calls: `renderizarLibros()` and `cargarTodasLasPortadas()`.

**Some state lives in the DOM, not in a variable.** `filtroActual` is a global, but the search term is read straight out of `#search-input` by `renderizarLibros()` (debounced 300ms), so a render triggered from anywhere keeps the current search without anyone passing it.

Listeners are registered once in `inicializarEventListeners()`, guarded by `eventListenersInicializados`. Only `DOMContentLoaded` calls it today, but it is also exported on `window.gaboApp`, and the guard is what makes a second call harmless instead of doubling every handler.

All user-supplied text goes through `escaparHtml()` before being interpolated into `innerHTML`. Keep it that way — titles, authors and subtemas are free text.

`cargarTodasLasPortadas()` hits Google Books for every book lacking a `portada` and persists what it finds. It skips immediately when nothing is missing. Covers now only ever show in the reading-detail modal, since there are no cards left.

### The `···` menu

Everything that used to be the left sidebar lives in one popover: search, the status filter, *Nuevo tema* / *Una lectura* / *Varias lecturas*, export/import, and the user plus logout. The sidebar itself — theme list, five stat counters, filter row, the stacked status bar, the backup block — was deleted in the cut of 2026-09-26, because the wall already says most of it: the shelves **are** the theme list, each with its own count, and the legend above the canvas carries the three status totals.

Two things that are easy to get wrong here:

- **`hidden` needs `!important`.** `.menu-panel` is `display: flex`, and any author `display` rule beats the UA stylesheet's `[hidden] { display: none }`. The panel therefore opened on load until `[hidden] { display: none !important; }` went into the reset. The JS uses the attribute as its only switch, so that rule is what makes the switch work at all.
- **The offline banner is `position: fixed` and 48px tall.** It used to cover only the sidebar's title, which nobody missed; now the legend and the `···` button live up there. `mostrarBannerOffline()` / `ocultarBannerOffline()` toggle `body.con-banner`, and the shell answers with `margin-top` plus a shorter `height`. `--alto-banner` is the single source of that 48.

There is no analysis panel, no timeline and no charts. `js/charts.js` is gone; its only survivor is `token()`, which moved to the top of `js/estante3d.js`. If a chart is ever wanted again, read the note in "The 3D shelf" about what the wall already encodes before rebuilding one that repeats it.