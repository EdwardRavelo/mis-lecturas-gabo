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

**To look at the 3D shelf there is `banco-estante.html`**, which mounts the furniture directly
with invented data. The scene is only reachable inside the app and the app wants a Supabase
session, so checking a change to a light or a wood meant signing in with GitHub and waiting for
the library to load. `?modal=1` mounts an open shelf instead of the wall. It is not app code —
nothing links it and it is not in `index.html` — so it can be deleted without consequence.

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

**The identity comes from a Figma Make export that lives in `Figma/`**, kept as the design
source of truth and git-ignored: it is a React/Vite/Tailwind scaffold, not app code. The thing
that made it portable is that **it does not use Tailwind** — its 170 lines of `src/index.css`
are hand-written CSS with semantic class names, and the component only applies them. So the
design came across to the vanilla app without React, Vite or a build step, and the
everything-is-a-global architecture above is untouched.

The export called itself *Marginalia*; the brand in use is **Diario de Lecturas**.

`css/styles.css` holds the tokens, the shell and the chrome; `css/animations.css` the keyframes
and the `prefers-reduced-motion` block; `css/estante.css` the shelf.

Type is **Playfair Display** for display and **DM Sans** for data. Surfaces are warm near-black
(`#100F0D` / `#191815`), the accent is amber `#BF8550`.

**Every colour lives in the `:root` block**, and `js/estante3d.js` reads it from there via
`token()`, so the palette reaches the WebGL scene on its own. Two places still carry a literal
colour and a retheme has to sweep them: the favicon data URI at `index.html:7`, and the
`token()` fallbacks in `estante3d.js`.

### The status colours are not the design's, and that matters

The export shipped `#73b488` / `#d39a51` / `#8f82c8`. Through the `dataviz` validator
(`--pairs all` — the three sit together in the filter bar) they failed four checks:

- the green fell **below the chroma floor** — it renders as grey
- green and amber sat at **ΔE 13.7 under normal vision**, below the hard floor of 15: even with
  full colour vision they are hard to tell apart
- ΔE 7.0 under protanopia, and two outside the lightness band

They were re-stepped keeping the design's hues. What ships passes all five checks with no
warnings against **both** surfaces they appear on (`#191815` and `#100F0D`):

```bash
node <dataviz>/scripts/validate_palette.js "#37A06A,#C07E24,#9184DC" --mode dark --surface "#191815" --pairs all
```

Worst pair `#C07E24` ↔ `#37A06A`: ΔE 8.1 protanopia, 17.7 normal vision. **Do not change them
without re-running the validator.** This is the third palette in the project's history and the
third time the check caught something; a designer's eye picks hues, not separations.

### The shell is the scene

```
.library-layout  (flex column, 100dvh, never scrolls)
  .library-room       full bleed, no padding
      .bookcase       absolute inset 0 -> the WebGL canvas + the accessible mirror
  .book-detail        floats over the scene, only while a book is chosen
  .menu-panel         the dialog the table opens
```

There is no top bar and no collections nav. **Everything they carried now hangs off an object in
the room**, and the mapping is meant to be guessable rather than clever: a spine fills the
floating detail panel, a plank opens that theme's shelf modal, the lamp switches the light, the
stack of books on the table adds a reading, and the table itself opens the menu — search, status
filters, collections, add, backup and session.

Three consequences, and none of them is optional:

- **`mostrarPista()` stopped being a nicety.** It used to name a spine, which has no text. Now it
  is the only thing that says what an object *does* — these are buttons that do not look like
  buttons, and an interface made of furniture only works if the furniture says its name on hover.
  It takes `{libroId}` or `{etiqueta}`; the label lives in `userData.etiqueta` beside the action.
- **The accessible mirror is now the only keyboard path in the whole application.** While there
  was a bar, the mirror could get away with listing books: the menu, the add button and the light
  were real buttons and tabbed by themselves. They are now a table, a pile and a lamp inside a
  `<canvas>`, which does not exist for the keyboard or a screen reader. `crearEspejoEstante()`
  therefore opens with the three room actions, before the shelves — the tab order *is* the bar
  that is no longer drawn. Verified: nothing outside the scene, the modals and the detail panel
  is tabbable.
- **The menu's state lives on the panel**, not on a button. It rode on `#menu-btn`'s
  `aria-expanded`, and that button went with the bar; a table in a WebGL scene carries no aria.

**The panel summarises; the modal edits.** Clicking a spine fills `.book-detail` — cover, state,
progress, your own comment as the pull quote — and **Ver notas y detalles** opens the existing
`#edit-modal`, which stays the only place anything is written. The panel now floats over the
scene and disappears entirely when nothing is selected. As a fixed 310px column it could not: an
empty column that wide reads as a bug, which is why it used to carry a line explaining what it
was for. Floating, the problem solves itself — no book, no panel, and what shows through is the
room.

**The scene is full bleed, and the frame it had was removed deliberately.** `.estante-escena` had
a border, a radius and a double bevel that said *this is a piece set into a page*. Once the scene
is the whole application, a frame turns it back into an illustration inside something else. Its
`padding` went for the same reason: the breathing room comes from `encuadrarEscena()`'s 1.03
margin, which belongs to the **camera**, so it holds while you orbit and zoom. A CSS padding is a
dead border that does none of that.

The `blockquote` in the aside is the reading's own `comentarios`. The design had a made-up
literary quote there; inventing one under a real reading would be a small lie.

### The cabinet's frame is 3D, and it has to be

The export draws the bookcase frame — sides, cornice, feet — in CSS around the shelves.
Ported literally, that frame would sit still while the WebGL cabinet rotates inside it, which
reads as broken the moment you turn it. So `construirCarcasa()` builds it as geometry, **inside
the `mueble` group**: it turns with the furniture and it counts toward the bounding box that
`encuadrarEscena()` and the pan limits measure — which is right, because the frame *is* the
furniture.

It also fixes the reason the orbit was capped at ±30°: the cabinet was planks and a back panel
with no sides, top or bottom, so past that angle you saw it was a façade. With a carcass that
limit could be loosened.

**The app is a 100dvh shell and the page never scrolls.** Only the menu panel, the detail panel
and the modal bodies scroll. `.library-room` still needs `min-height: 0`, and `.bookcase` is now
`position: absolute; inset: 0` inside it — it was a flex child of `.shelf-column`, which went
with the redesign.

`.library-layout` must keep working as **flex** — `auth.js` sets `appLayout.style.display =
'flex'` inline when hiding the login, which would override a `display: grid`.

Breakpoints: ≤1020px the top bar wraps and the aside narrows; ≤760px the room stacks and the
aside docks to the bottom of the screen.

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

   **`.estante-plano` carries its own scrolling and its own padding**, and that became load-bearing
   with the full-bleed redesign. While the cabinet lived in a padded column the flat shelf had the
   room's gutter around it and room to grow; now `.bookcase` is `position: absolute; inset: 0` and
   `.library-room` clips whatever overflows, so six flat shelves would be cut off at the bottom
   with no way to reach the rest — in exactly the situation where the app has to stay usable,
   not half of it.

### Navigating it: wheel to zoom at the cursor, middle-drag to turn

Both scenes take `OrbitControls` through `crearControles()`, with the same limits so the
furniture behaves the same in the wall and in the modal: ±30° of azimuth, 20° above the
horizontal, up to 36° below it, and 0.22×–1.25× the fitted distance. The near limit is what lets
you get close enough to read one shelf's spines; it was 0.55× and that only ever framed the whole
cabinet. The far limit was 1.6×, which let the cabinet shrink until the edge of the room showed.

**There is no free pan, and that is the point.** `enablePan` is false and the left button is
unbound: dragging the furniture anywhere you liked felt chaotic — you ended up somewhere with
no idea where. What replaced it is the parallax in `montarMuro()`, which follows the cursor a
few degrees and returns to centre on its own. You still reach any shelf: the wheel zooms to
the cursor and the collections nav filters. Middle drag (the wheel pressed) rotates; the right
button is unbound on purpose. One finger rotates, two fingers dolly-rotate.

The middle button needs one guard: pressing it triggers Chrome's autoscroll — the four-arrow
widget — which swallows the drag. `OrbitControls` does not stop it, because it never calls
`preventDefault()` on `pointerdown`. `instalarNavegacion()` does, in the capture phase;
cancelling the `pointerdown` also suppresses the compatibility `mousedown` that actually
triggers the widget.

**Zoom goes to the cursor, and that is hand-written.** `OrbitControls` always dollies toward
its `target`, which in a wide cabinet means you must zoom into the middle and then pan across
to the shelf you wanted. r147 has no `zoomToCursor` — it landed in a later release — so
`instalarNavegacion()` takes the wheel. It finds the world point under the cursor (whatever
the ray hits, or a plane through the target when the cursor is over empty space) and scales
camera *and* target toward it by the same factor: the point stays pinned on screen while the
distance drops, which is what "zoom there" means.

**Zooming out is not the same gesture reversed — it recentres.** Anchoring the zoom out to the
cursor too *amplifies* the target's offset from centre, so pulling back left the cabinet drifting
further off-frame the further you went. So the wheel handler splits the two directions: zoom in
goes to the cursor, zoom out is a plain dolly (the camera retreats, the target does not move)
plus a pull of the target back toward the furniture's centre — the same point
`encuadrarEscena()` and `crearControles()` start from, so arriving there is literally the
opening framing.

The pull factor is what remains of the zoom travel after the notch over what remained before it,
`(tope − nueva) / (tope − distancia)`. Chained over several notches the product telescopes to
`(tope − distancia) / (tope − distancia inicial)`, i.e. the offset fades **linearly in distance**:
no jerk at any notch, and exactly zero at the far stop. Measured from a hard zoom into a corner
(offset 68.9 at 0.22×): 52.3 at 0.47×, 26.4 at 0.86×, 0 at 1.25×. The corollary is that a
*partial* zoom out only partially recentres, which is intended — it tracks how far out you went.

That listener sits on the container in the **capture** phase and calls `stopPropagation()`,
so the control's own wheel handler on the canvas never sees the event. Its `enableZoom` stays
`true` on purpose, because the two-finger pinch is still handled by the control itself.

**The wheel does not move the camera; it books a factor.** Each notch used to apply its 14% in one
go and the zoom went in steps. Now `alRueda()` only accumulates into `zoomPendiente` and kicks the
animation loop, and `pasoZoom()` — one call per frame — spends `zoomPendiente^0.22` of it, leaving
the rest for the next frame. A notch lands in about ten frames of visible travel.

This is only sliceable because **both branches of the zoom are multiplicative scalings about a
point** — the cursor going in, the target going out — and a scaling is the product of its parts:
applying the whole factor or N slices of `factor^(1/N)` reaches exactly the same place. The
zoom-out recentring survives it too, for the same reason it survives chained notches: its product
telescopes (see below). Measured: zoom hard into a corner until the target is 68 units off centre,
then zoom all the way out, and it comes back to the opening framing with a deviation of **0**.

Four things to keep in mind here:

- **Accumulating is what makes fast scrolling feel right.** Each notch multiplies into the pending
  factor rather than reading the live distance, so spinning the wheel does not come up short; and
  mixing directions cancels out, which is what anyone expects.
- **Clamping and converging are different things, and conflating them cost accuracy.** The
  "already at the stop" test used to sit on the per-frame `factor`, but a slice is only 22% of the
  pending in log terms, so it fired four and a half times too early and threw away 0.2% of the
  travel *per gesture* — and since each notch restarts from the real distance, that never gets
  made up, it accumulates. The test now asks whether the stop actually truncated the slice, which
  is the only real reason to discard what is left. Error per gesture: 0.05%.
- **It has its own continue flag**, not the loop's `sigue`, which further down doubles as "something
  moved, redo the shadow". A zoom moves the camera and nothing else.
- **`alCambiar` has to start the loop, not request a frame.** It was `pedirRender()`, which would
  paint the first slice and stop there.

With `prefers-reduced-motion` the slice is the whole thing — `SUAVIDAD_ZOOM` becomes 1 and the
zoom is instant again, like the damping that `sinInercia()` already turns off.

**Panning is bounded.** `limitar()` clamps `controles.target` to the furniture's bounding box
plus 12%, and shifts the camera by the same delta so the view does not jerk — the pan simply
stops at the edge. It runs from the `change` handler. Without it you can drag the shelf off
into empty space and have no idea where you are.

**The floor is the tilt limit, and it has to be a limit on HEIGHT rather than on degrees.**
Tilting the view up means lowering the camera: eye height is `target.y + distance · cos(phi)`,
so past 90° the cosine goes negative and the camera drops further the further out it is. A fixed
cap in degrees forces a choice between two bad options — set it tight and you can barely tilt when
close, set it loose and zooming out puts the camera under the floorboards. And under them there is
nothing: the floor is a single-sided `PlaneGeometry`, so from below it vanishes and the room is
left floating over a void. With the old fixed 111.6°, at the far stop the camera sat **115 units
below the floor**.

So `limitarInclinacion()` solves for the phi that puts the eye level with the boards and uses that
as `maxPolarAngle`, recomputed on every `change`. Close in you can tilt the full 36°; as you pull
back the cap closes toward the horizontal on its own. It also catches the case the mouse never
touches: zooming out while already tilted down lengthens the radius and sinks the camera without
any rotation at all, so if phi is already past the cap the camera is lifted back to it, keeping
distance and azimuth.

Two details to preserve. It reorients with `camara.lookAt` — `limitar()` can skip that because it
moves camera and target by the same delta and the direction never changes, but this one is a
rotation. And it must **not** call `controles.update()`: it runs inside the `change` handler and
that would re-fire it. Touching the camera directly is safe because OrbitControls rebuilds its
spherical from `camara.position` at the top of every `update()` — which is the same reason
`limitar()` gets away with it.

`construirHabitacion()` returns the floor's `y` for this. It is the one place that knows it, and
both mounts pass it into `instalarNavegacion()`; the wall also calls `navegacion.limitar()` once
at mount, so a view restored from `vistaMuro` gets corrected if the new filter left a shorter
cabinet and the saved angle now falls through the floor.

**The camera orbits; the furniture does not turn.** That is what lets the shadow map be frozen
(`congelarSombras()`): nothing in the scene moves while you drag, so there is nothing to
recompute. A turntable would rebuild a 2048² shadow map every frame of the gesture. The one
case that *does* move something is a book's hover tween, and the animation loop asks for a
shadow update only on those frames.

The ±30° cap was not timidity: the furniture used to be planks plus one thin back panel per
shelf, and past that angle you saw there was no cabinet there. `construirCarcasa()` since built
the sides, cornice and feet (see "The cabinet's frame is 3D"), so the reason is gone and the cap
is now just a choice — it can be widened.

**Four things this breaks if you touch it carelessly:**

1. **A drag must not open a shelf.** Both scenes record the `pointerdown` position and drop the
   `click` if the pointer travelled more than 4px. The threshold is in pixels, not
   milliseconds, so a slow short drag still counts as a click. Without it, letting go after a
   rotation opens whatever ended up under the cursor.
2. **Hover is suspended between `start` and `end`.** Otherwise the raycast fires ~60 times a
   second through the drag and the tooltip strobes.
3. **Damping needs `update()` every frame.** `OrbitControls` only carries the inertia forward
   while something calls `update()`; the `change` listener re-renders but does not advance it.
   The existing `animar()` loop hosts it and keeps running while `update()` returns true. This
   was already broken in the modal before the wall got controls — the spin stopped dead on
   release.
4. **`renderizarLibros()` rebuilds the wall on every keystroke**, so the view has to survive
   it. `vistaMuro` keeps theta, phi, the distance **as a fraction** of the fitted one, and the
   pan offset **also as a fraction** — both absolute forms would be wrong, because the fit
   depends on how many shelves the filter left visible and the cabinet shrinks as you filter.
   `encuadrarEscena()` therefore returns `{ centro, dist }`, not just a point, and the view is
   restored *after* the controls exist, since it has to set their target too.

Auto-fit on resize only applies until the first interaction; afterwards a window resize just
updates the aspect ratio instead of yanking the camera back to the front. Double-clicking the
background resets — and it clears `vistaMuro` *after* calling `controles.update()`, because
that call fires `change` synchronously and the handler there would otherwise immediately save
the view again.

### Looking like wood instead of like WebGL

Five things carry the realism, and they are easy to undo by accident:

- **Tone mapping.** `ACESFilmicToneMapping` at exposure 0.86. Without it highlights clip to flat
  white, which is the single loudest "this is a render" cue.
- **An environment map.** `RoomEnvironment` through `PMREMGenerator`, generated in code with
  nothing downloaded. A `MeshStandardMaterial` with no `envMap` has **no specular at all** —
  every surface is pure diffuse, which is why the wood used to read as matte plastic. It also
  lights in diffuse, so `ajustarEntorno()` drops `envMapIntensity` to 0.30 on every material;
  at full strength the whole piece washes out to pastel.
- **Bevelled edges.** Books and planks use `RoundedBoxGeometry` at their real size, not a scaled
  unit box — scaling a unit rounded box non-uniformly stretches the bevel along the long axis.
  A 90° edge never catches a highlight and the eye reads that instantly.
- **Contact shadow.** One soft dark strip per shelf where the row meets the plank. Cast shadows
  do not produce the darkening in the millimetre gap under a book, and without it the books look
  pasted on.
- **A room to cast into** — see below.

**The face mapping is the thing to be careful with.** `BoxGeometry` order is +X, −X, +Y, −Y,
+Z, −Z. With the spine toward the viewer at +Z: ±X are the **covers**, ±Y and −Z are **paper**.
This was wrong for a while — the covers were painted with the page material — and every tilted
book showed a big cream slab that looked like cardboard.

**The spine title is its own plane, not a face material.** `RoundedBoxGeometry` spreads UVs over
the rounded shell, so the flat face no longer maps 1:1 to the texture and titles came out
clipped at the sides. A plane 0.02 in front of the spine sidesteps it entirely.

### The room, and the group that keeps the camera sane

The furniture stands against a back wall, with a floor below. What the planes buy is not
themselves: it is the shadow, and the sense that the cabinet is somewhere. An object with
nothing behind or beneath it does not look like it is anywhere; it looks cut out.

**The light pool is what makes it a room rather than a backdrop.** A directional light has no
falloff: it lights the metre of wall behind the cabinet exactly as hard as the wall three hundred
units to the side. With a flat wall colour the result was a uniform black void from edge to edge,
and *no* amount of joinery detail fixes that — the eye reads the background first, and a
background with no gradient says "render" before you have looked at anything else.

So the falloff is painted, not lit. `pintarPozo()` lays a warm halo and a dark close-down into a
canvas; `texturaPared()` uses it at wall scale and `penumbraSuelo()` at floor scale. It costs two
canvases, no extra light and no extra shadow map. The wall is centred on the cabinet and is never
measured by anything, so the oval lands behind the furniture on its own.

Three details that are easy to get wrong here:

- **The floor's pool cannot go in the floor texture**, which tiles 26×; a vignette repeated 26
  times is 26 vignettes. It goes on its own transparent plane just above the floor — the same
  device `sombraDeContacto()` uses under each row of books — sized and placed to match the floor
  exactly, so there is no edge where the darkening stops. And because the floor runs *from* the
  wall *toward* the viewer, the clear spot sits near one edge of the canvas, not in the middle:
  with `rotation.x = -90°`, the plane's `v = 1` falls on the wall and `v = 0` ends up behind the
  camera.
- **The plaster grain is a `bumpMap`, not a `map`.** The colour map is stretched once over a
  thousand units, so anything fine painted there would come out the size of a table. Relief can
  tile, because grain has no motif to give the repeat away.
- **The wall is panelled, and that forced the pool onto its own plane.** One texture stretched over
  a thousand units gives about two world units per texel at 512² — fine for a gradient, useless for
  a moulding. Raising the resolution until a moulding is crisp means 2048², or 16 MB of GPU for the
  backdrop, more than the rest of the scene put together, when the only thing that needs repeating
  is one bay. So `texturaPared()` now draws a single 256×512 bay and tiles it, which puts a texel
  at a quarter of a unit. The panel count is derived from the wall's **world width** (one bay per
  ~54 units), never fixed, because the wall grows with the scenery and a fixed count would stretch
  the panels every time something is added.
  The price is that the light pool could not stay in that texture — tiled fourteen times it would
  be fourteen pools — so it moved to `veloPared()`, a transparent plane half a unit in front. Its
  warm halo was dropped entirely: it was painted before the scene had a lamp, and now there is a
  real one throwing a real pool with real falloff.
  The mouldings' light is **baked** — top and left edges dark, bottom and right bright — and that
  is correct rather than a shortcut, because neither the wall nor the key light ever moves. Anyone
  who changes the key's direction has to come here and flip them.
- **The skirting board is the cheapest piece in the room and does the most.** Without it, wall and
  floor meet along a geometrically perfect line that exists in no actual room, and the junction
  reads as the edge of two sheets of card. It carries `texturaDesvanecida()` as its `map`: it is a
  thousand-unit batten under a light with no falloff, so without the mask it would be a bright
  stripe crossing the frame from edge to edge however dark you painted it.

**The floor's boards run toward the viewer, not across.** Laid across the view their joints are
straight horizontals parallel to the frame edge, which is precisely the pattern of a tiled floor —
and that is what it looked like. Turned a quarter turn the same joints become converging lines,
and the floor's perspective is half the depth in the scene. It is one `tex.rotation`, and it is
the difference between a room and a diorama.

**The wall spans far more than the furniture** — fourteen times its width. The demanding case
is not the opening frame but the worst one: the camera at its furthest (1.25× the fitted
distance, around 345 units) *and* turned to the ±30° stop. There the camera slides some
345·sin(30°) ≈ 172 sideways and still sees well past that, so the farthest visible point lands
some 300 from centre. At seven times the cabinet's width the wall reached 260 and black showed
at the edge. A plane is two triangles, so overshooting costs nothing and falling short is
obvious on sight — keep the margin even though the far limit came down from 1.6×.

It was briefly built as a niche instead — five faces boxing the cabinet in, pointing inward on
`FrontSide` so the near wall culled away as you turned. It worked, but it framed the furniture
more than it housed it, and it was dropped. If anyone rebuilds that, the culling trick is the
part worth keeping.

`construirHabitacion()` also widens the light's shadow frustum; left at the furniture's size the
shadow gets cropped by a straight edge halfway up the wall, which looks worse than no shadow at
all. The frustum is sized from the *furniture*, not from the wall — the wall is now hundreds of
units across and scaling the shadow camera to it would waste the whole 2048² map on empty space.

**The scene is split three ways, and which tier a thing goes in is load-bearing.**

| Tier | What is in it | Who measures it |
|---|---|---|
| `mueble` (Group) | the bookcase: shelves + carcass | camera framing, zoom limits, pan clamp, wall placement |
| `escenografia` (Group) | the plant, the side table | camera framing only |
| the scene | wall, floor | nothing, ever |

The wall is hundreds of units across; measuring it pushes the camera back until the furniture
is a postage stamp and leaves the limits meaningless - so it is never measured. But the plant
and the table are objects with real extent, and leaving them out of the framing is how they end
up outside the opening frame where nobody sees them. Hence the middle tier: `cajaDe()` takes one
object or several and unions their boxes, and `montarMuro()` frames on `marco = [mueble,
escenografia]` while the pan clamp still measures `mueble` alone.

**Add a piece of furniture to `escenografia`. Add a backdrop to the scene.** Never to `mueble`,
which is what the app is actually about.

**The table lamp is the second thing that made this a room** (the first is the light pool above),
and for the same reason. A room lit by a directional light with no visible origin is a photo
studio. The moment the lamp is in frame, the warm light coming from the left stops being a render
setting and acquires a reason inside the picture. It carries its own `PointLight` — a shade that
glows with no pool of light under it reads as an object painted yellow — with `distance` set, so
the falloff that is the whole point does not wash out over the back wall. It casts **no** shadow:
the scene's shadows come from the frozen directional light, and a second 2048² map to light one
corner would cost as much as everything else together.

Its shade is a gradient, and that is not decoration. A lit shade is never one value — the bulb is
inside and low, so the bottom hem burns and the shoulder stays in shadow. Flat cream with the
emissive turned up gave a blown-out white cone that was the brightest thing in the frame, and the
brightest thing in the frame has to be a book. The gradient rides both `map` and `emissiveMap`,
so it modulates the diffuse colour and the glow with one drawing, which is what a fabric with a
bulb behind it actually does.

**The lamp switches off**, by clicking it in the scene or from the `···` menu, and three things
about that are load-bearing:

- **The key light goes with it.** Killing only the point light would leave the room just as lit by
  the directional and the gesture would show up in one corner. The directional *is* that lamp — it
  is why the key is amber and comes from the left — so it drops to 22%, and the cool fill goes
  *up*, not down: it is the only thing still lighting the room, and without that the cabinet sinks
  into flat black.
- **The shadow map stays frozen.** Changing a light's *intensity* does not invalidate its shadow
  map — it is a uniform, not geometry — so `congelarSombras()` still holds and the switch costs no
  2048² recompute. The fade therefore sets its **own** continue flag rather than the loop's `sigue`,
  which further down doubles as "something moved, redo the shadow". Wiring it into `sigue` cost a
  full shadow rebuild on every frame of a fade in which nothing moves.
- **The state is module-level, like `vistaMuro`, and for the same reason**: `renderizarLibros()`
  unmounts and remounts the wall on every keystroke, so a variable inside `montarMuro()` would be
  lost and the lamp would switch itself back on as you type. And when the tab is hidden the fade
  is skipped and the value applied outright — the browser stops `requestAnimationFrame` there, so
  the fade would stall mid-way and leave the state saying "off" with the lights still at full.

The `···` menu carries the same switch, and that is not decoration: a `<canvas>` does not exist for
the keyboard or a screen reader, so without it the switch would have a mouse path only. Same rule
as the shelf's accessible mirror. The two stay in sync through `window.gaboApp.sincronizarBotonLuz`
— the same cycle-breaking trick `auth.js` ↔ `app.js` uses.

The stack of three books next to it is the only prop in the scene that says what the room is for.
Two things about it: they are **flat** (a book lying down is far wider than it is thick; at the
first thickness they were blocks, and bevelled blocks are lozenges), and their colours come from
three fixed binding hues rather than from the hash, which spread them around the whole wheel and
produced three turquoise objects that read as a stack of plates.

Two knock-on effects to keep in step, both already wired:

- `construirHabitacion()` sizes the wall and the shadow frustum from the **framed** box, not
  the cabinet. Adding decor pushes the camera back, so what used to be generous stops being
  generous; and a plant outside the shadow frustum casts nothing, which makes it look pasted on
  rather than standing on the floor.
- The zoom-out recentring targets the **framed** centre. `instalarNavegacion()` takes it as
  `centroVista`; the cabinet's own centre would leave the reset off by exactly however much the
  decor shifts the view. The modal passes nothing and falls back to the cabinet, which is right
  - it has no decor.
- **The far clipping plane is computed, never hardcoded.** This one bit already: the camera was
  born with `far = 500`, comfortable while the framing measured only the cabinet and the zoom-out
  stop was 344 units. With the decor in the box the fitted distance went to 428 and the stop to
  535 — past the plane. The symptom did not look like clipping, it looked like a bug: at the far
  end of the wheel the cabinet, the wall and the table **vanished**, leaving bare floor.
  `ajustarProfundidad()` now derives `far` from the controls' own `maxDistance` plus the scene's
  bounding sphere, and runs right after `crearControles()` in both mounts.

  It raises `near` at the same time, from 0.1 to a fraction of `minDistance`. Nothing in either
  scene ever comes within tens of units of the eye, and a near plane that close throws away most
  of the depth buffer — the margin it wins is what keeps two touching spines from flickering
  over each other.

  Worth knowing: the wall's corners were **already** being clipped before any of this, because
  turned to the ±30° stop the far corner sits around 700 units out. Nobody ever saw it, because
  the wall is near-black against a near-black page. Any future change that moves the camera back
  — more decor, a wider fit, a looser zoom limit — must keep this function in the loop rather
  than re-tuning a constant.

The framing margin is 1.03, not the old 1.10. Once the decor is in the box it is the **width**
that drives the fit, and the loose margin left a band of empty wall above and below with the
cabinet small in the middle.

`tocado()` can keep raycasting the whole scene: it walks up parents looking for `libroId` or
`esBalda` and finds neither on a wall. For the wheel it is an improvement — pointing at empty
space now focuses a real surface instead of an imaginary plane.

### Why the scene has two colour temperatures

`--pared` is a deep petrol blue and the key light is amber. That pairing is deliberate and it is
what stopped the render looking muddy: with a single warm light and warm surfaces, everything
fell in one family of browns and read as monochrome. Cool shadows against warm highlights is
what gives a dark scene colour without brightening it.

The fill light was at 0.09 — effectively off — and is now 0.30. Book lightness was clamped to
0.13–0.38, which is very dark for something meant to read as colour; it is now 0.20–0.55. Spine
hue spreads ±32° around the theme accent rather than ±18°, so a shelf still reads as one theme
but stops looking painted from a single tin.

**A horizontal plane catches the key light almost head-on** while the wall takes it at a
glancing angle, so with the same colour the floor lights up far brighter and reads as a pale
ledge under the cabinet. It is darkened on its own rather than by dimming the whole scene, and
it sits well below the bottom shelf — close up it just looked like one more plank.

**The floor is a plank floor, not a flat colour.** `texturasSuelo()` draws one tile of boards in
a running bond and returns it twice - in colour as `map`, in grey as `bumpMap`, so the joint
between boards actually sinks instead of being a painted line. Two things about it are worth
knowing before touching it:

- **Proportion is what separates a wood floor from tiling.** The first pass used five rows of
  two boards each, which is 2.5:1, and the result read as paving slabs. A real board is nearer
  9:1: one board per row, nine rows. `REPETICION_SUELO` (26) then sets how often the tile
  repeats across a plane that is over a thousand units wide.
- **The floor is the one room surface that wants a sheen.** It skips the room's matte 0.94 for
  roughness 0.56 and `envMapIntensity` 0.38, because reflecting the lamp instead of swallowing
  it is half of what makes a floor read as a floor. It still has to stay quieter than the
  furniture, so its `map` is multiplied down by `color`.

**The room must stay quieter than the furniture.** Wall and floor set `envMapIntensity` to 0.12
and mark `userData.entornoFijo`, which `ajustarEntorno()` honours — that pass runs after the
room is built and used to overwrite the setting, leaving a wall that lit up brighter than the
cabinet it was supposed to sit behind.

### The plant

A **ficus lyrata**: a bare woody trunk and a dozen large, entire leaves.

It was a monstera for two passes, and the reason that failed is the most portable lesson in this
file. A monstera's identity lives in its **filigree** — deep lobes, fenestrations, a heavily
indented outline. At the size this plant actually renders, filigree does not read as filigree; it
reads as a dirty edge. Each pass made the shape more botanically correct and each pass still came
out looking like a paper cut-out.

The fiddle-leaf fig works because it goes the other way: its silhouette is a few big **smooth**
paddles on a naked stem. There is no fine detail to lose at distance, because there is no fine
detail. And the contrast between bare trunk and broad crown survives at any size, which is the
whole job of a background object.

**The rule, for next time: at this scale choose a plant for its mass and overall outline, never
for the detail of its leaf.** A palm or a fern — dozens of small leaflets — would fail for exactly
the reason the monstera failed, and cost far more geometry doing it.

The leaf is a `THREE.Shape`: an **obovate** width profile — widest past the middle, blunt at both
ends — then `ShapeGeometry`, then curvatures applied by hand to the vertices: the droop toward the
tip, which is weight; the channel along the midrib, which is how a big leaf holds itself up; a
gentle undulation of the margin; and a slight twist, because no leaf lies in a plane. A flat leaf
is a paper cut-out.

Four things here were each got wrong once, and each is a trap worth naming:

- **Do not model the violin.** The plant's name invites a waist, and the first attempt built one
  by summing two gaussian lobes, a small one at the base and a broad one at the apex. Marked
  enough to be visible, the leaf stops reading as a leaf and reads as two lobes stuck together —
  an oak. A real fiddle-leaf's waist is a hint. Here it is 11% off a single bell.
- **The margin's ripple must die out at both ends.** A sine wave landing near `t = 1` bites the
  tip and leaves it serrated — which is exactly how these went from ficus to maple. It is
  multiplied by `sin(πt)`.
- **The second argument of `geometriaHoja` is the HALF-width.** The outline is drawn at ±`borde`,
  so the total is twice that. It sat at `largo * 0.62` for a while — leaves **wider than they were
  long**, which came out circular and turned the fig into a jade plant. A fiddle-leaf runs about
  1.6:1, so the half-width is ~0.29 of the length.
- **The undulation is in the surface, not just the outline.** Notching the edge while leaving the
  surface flat gives a saw blade. Rippling the surface makes each trough catch the lamp
  differently, which is what gives the paddle any relief at all. It grows with r² so the midrib
  stays put — and at the first amplitude (0.22 of the width) it curled the leaves into tacos. It
  is 0.07.

The two sides of every leaf get different wave phases, and the leaves get their length, roll and
tone from `hashEstante`, never `Math.random()` — the same reason as the books: the wall is rebuilt
on every keystroke.

**The venation rides two maps from one drawing.** As `map` it can only darken — `map` multiplies —
so the canvas is mid-grey with **white** veins, and what reads is the blade dropping a stop while
the veins stay put: pale venation on dark green, which is the plant's signature. As `bumpMap` it
gives the leaf a surface. That second half matters more than it sounds: a painted-only venation is
a decal on a perfectly smooth paddle, and it looks like one. It is also what let the gloss come
back up — the leaves had been dulled to 0.62 roughness because they looked like plastic, but the
problem was never that they shone, it was that they shone *flat*, with one highlight sweeping the
whole paddle. Broken up by the bump, a leathery sheen is fine.

Veins are neither evenly spaced nor uniform — at a fixed pitch and width the venation reads as a
comb, which is the first thing that gives it away as a drawing — and each one is stroked in
segments that thin and fade toward the margin, which is the second.

**`ShapeGeometry`'s UVs are not normalised, and this one bit for a long time.** Its source says so
in a comment — `uvs.push( vertex.x, vertex.y ); // world uvs` — so `u` runs from 0 to the leaf's
length in world units, about 25, not 0 to 1. With the default ClampToEdge wrapping, the whole leaf
except a one-unit strip by the petiole was painted with the **last column of pixels** of the
canvas. The venation was not subtle, it was not being drawn. `geometriaHoja()` now divides through
by `largo` and `2 * ancho` before subdividing. Anything else that reaches for `ShapeGeometry` has
to do the same.

**`ShapeGeometry` does not tessellate the interior** either, and that is why `subdividirMalla()`
exists.
It triangulates the polygon from the outline vertices and nothing else, so the middle of a leaf is
a handful of enormous triangles. However fine the curvature applied afterwards, the shading is
interpolated in a straight line across half a leaf and what you see is facets — the plant looked
folded out of paper. Two midpoint subdivisions (each triangle into four) fix it: about 2,800
triangles a leaf, 36,000 for the whole plant, built in 8.6 ms. That is a lot for a background
object and it is still fine, because there is no render loop — but it is the one place in the
scene where a careless change gets expensive. It must run **before** the vertices are displaced:
subdividing an already-curved mesh only splits the facets that are already there.

**The trunk is half the silhouette**, and it is built as a `CylinderGeometry` whose axis is then
displaced by a smooth function of height. A perfectly straight trunk reads as a broom handle; the
S-bend costs one loop. The leaves hang off it by short petioles over its top three quarters, at
the golden angle, opening and drooping low down and tucking upright at the top — that is what
makes a crown instead of a wheel.

The pot is a `LatheGeometry` profile, not a cylinder: the belly and the lip are what read as
terracotta. Everything varies through `hashEstante`, never `Math.random()`, for the same reason
as the books - the wall is rebuilt on every keystroke and a plant that reshuffles itself while
you type is worse than no plant.

The plant is positioned **by the edge of its canopy, not by its centre**: the outermost leaf
reaches its stem radius plus its own length, and placed by centre it swung in front of the
bottom shelf and covered that shelf's label. Those labels are the only place the wall names a
theme, so nothing may overlap them.

That clearance (`vueloCopa`) is the longest petiole plus the longest leaf, times the cosine of the
angle they leave the trunk at, and **every one of those numbers lives in `construirPlanta()` while
the clearance is computed in `construirEscenografia()`** — so they have to be moved together.
Every time a leaf has grown and this has been left behind, the canopy has ended up in front of the
bottom shelf, over its label.

### Colours the 3D reads are LINEAR — and `colorMaterial()` is where that is paid

three r147 runs with `ColorManagement.legacyMode`, so `new THREE.Color('#1B3922')` does **no**
sRGB-to-linear conversion: the hex goes straight in as a linear value and the renderer's
`outputEncoding` then applies gamma on the way out. A hex that looks like a deep forest green in
a swatch comes out of the render as pale sage.

This was, for a while, the single most expensive defect in the scene, and it did not look like a
colour bug — it looked like the render was unfinished. Every hand-written material colour came
out one to two stops lighter and more washed than written: the cabinet's **edge** was paler than
its own shelves, the terracotta pot was salmon, the leaves were mint, and the spines read as
boiled sweets rather than cloth. Nothing about the modelling was wrong; everything was a stop
and a half too bright.

It was compensated for by writing the tokens pre-raised (`--planta-hoja` was `#081C0C` so that
it would render as `#3E6B4A`), which left `:root` full of hexes that looked like nothing and put
the burden on whoever picked the next colour.

**Now the conversion lives in one function.** `colorMaterial(nombre, respaldo)` reads the token
and calls `.convertSRGBToLinear()`. The tokens are real colours again — what you see in a swatch
is what renders — and `colorLomo()` ends with the same conversion, which is why its lightness
band could be stated in plain sRGB terms (0.30–0.62).

**The other half of the rule: this applies only where the colour feeds a material.** Colours that
end up drawn into a `<canvas>` — the wall gradient, the floor boards, the paper edges — travel in
a texture flagged `sRGBEncoding`, which the renderer already decodes. Converting those would
darken them twice. So: `material.color` → `colorMaterial()`; `ctx.fillStyle` → the raw token.

The scenography colours are decoration, not data: unlike `--leido` / `--leyendo` / `--pendiente`
they encode nothing, so they do not go through the `dataviz` validator.

### Spine thickness, and the data it does not have

`grosorLomo()` is `0.55 + paginas / 190`, clamped to 0.6–3.2: a 150-page book is visibly
thinner than a 500-page one.

**But the 94 readings imported by `supabase-schema-v3.sql` have no page counts** — that INSERT
does not include the column — so they all fell back to a single fixed width and the real shelf
was a picket fence of identical slats. Without pages the thickness now comes from
`hashEstante(id + '|grosor')` instead, spread over 0.8–2.2. It is deterministic like everything
else here, so a book keeps its width across the rebuild that happens on every keystroke, and
the moment a reading gets a real page count it starts using it.

### Spines are rounded, and that is a texture multiply

A flat-coloured spine face is the giveaway that a book is a box. `texturaCurvatura()` is one
shared greyscale gradient — darker at both edges, white at 42% — used as the `map` of every
cover material. `map` **multiplies** `color`, so white leaves the book's colour alone and grey
darkens the edges: a rounded back for one texture across the whole wall, no extra mesh, no
transparency.

It was first tried as a translucent plane in front of the spine, and that was wrong: a
`MeshStandardMaterial` plane is lit in its own right, so even at low alpha it adds white and
washes the colour out of every book. To *shade* a surface rather than light it, reach for a
multiply, not an overlay.

Keep the gradient gentle. The first pass went down to 28% at the edges and darkened the whole
spine rather than just its borders, which made the titles in the modal unreadable — they sit on
their own plane over the top and cannot outrun a spine that has gone dark. `texturaLomo()`
picks ink colour at a lightness threshold of 0.52, deliberately biased toward light text,
because the rendered spine is always somewhat darker than its base colour suggests.

Cover roughness varies per book (0.55–0.95 from `hashEstante(id + '|acabado')`): matte cloth at
one end, a satin dust jacket at the other. With all 97 at a single value the row caught the
light as one continuous sheet of plastic.

### Texture budget

Only the spine title is unique per book. `texturaHojas()` quantises to six variants,
`texturaTejuelo()` has exactly three — one per state — and `texturaCurvatura()` is a single
texture for the entire wall, so a 52-book theme builds 52 + 10 canvases instead of 156. They go
through `texturaCacheada()`, a module-level cache emptied in `destruir()`; that is safe
precisely because two scenes never live at once.

Spine canvases are 128×512 on purpose. 256×1024 is 1 MB each — 54 MB of video memory for one
large theme — and a spine draws about 20px wide even in the modal. When titles looked clipped
the cause was the UV mapping above, never the resolution.

Opening the largest theme costs about 50 ms and closing about 60 ms.

The floor adds two cached 1024-square canvases (colour and relief) and the leaf veining one
256-square, shared by every leaf - the plant builds no per-leaf texture at all. The room adds
five more, all cached and all small: the wall's 256x512 panel bay, a 128-square plaster grain, the
wall's 512-square veil, the floor's 1024-square penumbra, and two one-dimensional strips (the
skirting's fade mask and the lampshade's gradient) that are four pixels wide.

**Everything in here is rebuilt on every keystroke**, because `renderizarLibros()` unmounts and
remounts, and `destruir()` empties the texture cache. So a texture's build cost is a per-keystroke
cost, and that is the budget to think in — not video memory. The plaster grain was first drawn
with a per-pixel noise loop over 256², which cost 12 ms of `getImageData`/`putImageData` every
time and was **invisible**: tiled 22× across a thousand units of wall, one texel fell below one
screen pixel. It is now drawn with canvas rectangles at two scales and tiled 8×, which is both
0.4 ms and actually visible. A whole wall mount is about 65 ms.

The corollary for anything added later: if a texture needs per-pixel work, check first whether its
tiling puts that detail above one screen pixel. If it does not, it is not detail, it is cost.

**`destruir()` frees every texture slot, not just `map`.** It walks `MAPAS_MATERIAL`, which
exists because the floor introduced the first `bumpMap` in the project and the old one-line
disposal would have leaked it silently. Anything added later with a normal or roughness map is
covered by the same list.

### Accessibility is not optional here

A `<canvas>` is opaque to the keyboard, to screen readers and to Ctrl+F, and the theme and subtema names are **painted into textures**, so they do not exist as text anywhere else. `crearEspejoEstante()` renders the whole piece of furniture as real DOM — a visually-hidden but focusable list of buttons in the same order. Tab walks the books, focus pulls out the matching 3D book (`enfocarLibroEnMuro` / `enfocarLibroEnModal`), Enter opens the detail. It is clipped with `clip-path`, never `display: none`, which would take it out of the tab order — the whole point.

The status colours are the only signal on a wall spine, so the counts live in the top bar's filter pills, each carrying **name and number** next to its dot — never colour alone. That legend used to sit above the canvas; the bar replaced it.

Wall spines also carry no text — at 16px wide none would be legible, and it would mean 112 textures to say nothing. What a book *is* comes from `mostrarPista()`, a DOM tooltip fed by the same raycast that drives the hover. It is positioned with `transform`, not `top`/`left`, so the browser does not re-layout on every mouse move, and it flips to the other side of the cursor near a window edge.

### Geometry, and why it is deterministic

Spine thickness comes from `paginas` (1.15 when null, which is most of the catalogue). Height and hue jitter come from `hashEstante(id)` — a hash, never `Math.random()`, because `renderizarLibros()` rebuilds the furniture on every filter keystroke and random heights would make the books dance. Spine height is capped at 18.5 against a 28-unit back panel: the top third is reserved for the shelf label, and raising the cap puts the tallest book through the theme's name.

The label sits on the **back panel**, not on the plank edge where a real shelf would carry it. The plank edge is 1.7 units against 74 of width — about twelve screen pixels — and nothing legible fits there.

### Colour is how much you have read

A spine keeps its theme's colour in proportion to how far the reading got: `CROMA_POR_ESTADO` scales the saturation by 1 for `Leído`, 0.45 for `Leyendo` and 0.10 for `Pendiente`. The point is the glance — a wall that is mostly grey is a wall of books you have not read yet.

Three things about it are deliberate:

- **Lightness does not change with state, only chroma.** If unread books were darker too they would sink into the back panel and you would stop counting them. The only difference is colour.
- **`Pendiente` is 0.10, not 0.** A trace of hue leaves a *warm* grey that belongs to the room — `#5A5D68` under a blue theme, `#615F52` under amber. At exactly zero the furniture reads as a black-and-white photo pasted inside a colour scene.
- **The saturation jitter is applied before the state factor, not after**, so two grey books are still not identical to each other and the shelf keeps its texture.

This is a *second* encoding of state, not the only one. The tejuelo dot still carries the exact `--leido` / `--leyendo` / `--pendiente` colour, and the legend and the tooltip name it in words, so no single book's state ever depends on reading its saturation.

State shows as a **tejuelo**: the shelfmark label a library glues to the foot of a spine — matte, bordered, with a dot in the state colour. It replaced a saturated band across the whole lower spine that read as a fluorescent sticker. The dot is deliberately large: in the wall it is the only per-book state signal there is, and at 16px of spine width a subtle one disappears.

## Rendering

There is exactly one view. `renderizarLibros()` tears down the 3D wall, filters `libros` by `filtroActual` and the search box, and hands the survivors to `renderizarEstante()`. That is the whole render path — no card grid, no list mode, no `vistaActual`.

`actualizarInterfaz()` is now two calls: `renderizarLibros()` and `cargarTodasLasPortadas()`.

**Some state lives in the DOM, not in a variable.** `filtroActual` is a global, but the search term is read straight out of `#search-input` by `renderizarLibros()` (debounced 300ms), so a render triggered from anywhere keeps the current search without anyone passing it.

Listeners are registered once in `inicializarEventListeners()`, guarded by `eventListenersInicializados`. Only `DOMContentLoaded` calls it today, but it is also exported on `window.gaboApp`, and the guard is what makes a second call harmless instead of doubling every handler.

All user-supplied text goes through `escaparHtml()` before being interpolated into `innerHTML`. Keep it that way — titles, authors and subtemas are free text.

`cargarTodasLasPortadas()` hits Google Books for every book lacking a `portada` and persists what it finds. It skips immediately when nothing is missing. Covers now only ever show in the reading-detail modal, since there are no cards left.

### The menu

Opened by clicking the **table**. It is no longer an overflow popover hanging off a bar button — it is the only door to search, the status filters, collections, *Añadir libro*, *Nuevo tema*, *Varias lecturas*, the light switch, backup and session. So it is a centred dialog with a real dimmed veil behind it, not a corner panel over a transparent one. The sidebar it replaced — theme list, five stat counters, filter row, stacked status bar, backup block — went in the cut of 2026-09-26.

The markup moved but **the ids did not**, on purpose: `app.js` never cared whether a control sat in a bar or in a menu, so relocating it cost no JS. What did need changing were the styles that assumed a bar — the search box collapsed from width zero until you opened it, which is absurd inside a dialog you opened *in order to* search, and the stroke-icon rule was scoped to `.topbar` and `.category-nav`, so when those went the icons lost `fill: none` and rendered as solid blobs.

The status counts live in here, and they are **not decoration**: wall spines carry no text, so this is the only legend that names the three states in words and gives their number.

Two things that are easy to get wrong here:

- **`hidden` needs `!important`.** `.menu-panel` is `display: flex`, and any author `display` rule beats the UA stylesheet's `[hidden] { display: none }`. The panel therefore opened on load until `[hidden] { display: none !important; }` went into the reset. The JS uses the attribute as its only switch, so that rule is what makes the switch work at all.
- **The offline banner is `position: fixed` and 48px tall.** It used to cover the sidebar's title, then the bar's legend; now there is nothing above the scene for it to cover, so it simply eats 48px off the top of the room. `mostrarBannerOffline()` / `ocultarBannerOffline()` toggle `body.con-banner`, and the shell answers with `margin-top` plus a shorter `height`. `--alto-banner` is the single source of that 48.

There is no analysis panel, no timeline and no charts. `js/charts.js` is gone; its only survivor is `token()`, which moved to the top of `js/estante3d.js`. If a chart is ever wanted again, read the note in "The 3D shelf" about what the wall already encodes before rebuilding one that repeats it.