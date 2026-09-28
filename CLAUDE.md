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

### The shell

```
.library-layout  (flex column, 100dvh, never scrolls)
  .topbar          brand · status filters with counts · search · Añadir libro · ···
  .category-nav    Colecciones — filters by theme — N volúmenes visibles
  .library-room    grid: shelf column + detail aside
      .shelf-column   heading + .bookcase → the WebGL canvas
      .book-detail    the selected reading
```

Filters and search live in the top bar. They spent a while inside the `···` menu, which now
keeps only what does not fit up there: adding, backup and session.

**The aside summarises; the modal edits.** Clicking a spine fills `.book-detail` — cover, state,
progress, your own comment as the pull quote — and **Ver notas y detalles** opens the existing
`#edit-modal`, which stays the only place anything is written. That split is what keeps dates,
comments, state changes and the link working without duplicating the form. The aside is never
hidden: an empty column 310px wide reads as a bug, so with nothing selected it says what it is
for.

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

**The app is a 100dvh shell and the page never scrolls.** Only `.bookcase`, the menu panel, the
aside and the modal bodies scroll. `.library-room` needs `min-height: 0`, and so does
`.bookcase`: without it a flex child refuses to shrink below its content and the whole shell
overflows.

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

### Navigating it: wheel to zoom at the cursor, middle-drag to turn

Both scenes take `OrbitControls` through `crearControles()`, with the same limits so the
furniture behaves the same in the wall and in the modal: ±30° of azimuth, ±20° around the
horizontal, and 0.22×–1.25× the fitted distance. The near limit is what lets you get close
enough to read one shelf's spines; it was 0.55× and that only ever framed the whole cabinet.
The far limit was 1.6×, which let the cabinet shrink until the edge of the room showed.

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

**Panning is bounded.** `limitar()` clamps `controles.target` to the furniture's bounding box
plus 12%, and shifts the camera by the same delta so the view does not jerk — the pan simply
stops at the edge. It runs from the `change` handler. Without it you can drag the shelf off
into empty space and have no idea where you are.

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

**The wall and the floor go in the scene. The shelves go in a `THREE.Group` called `mueble`.**
This is not tidiness, it is load-bearing: `encuadrarEscena()` and the pan limits in
`instalarNavegacion()` both measure a bounding box, and measuring one that includes a 520-unit
wall pushes the camera back until the furniture is a postage stamp and leaves the pan limits
meaningless. Anything decorative added later goes in the scene, never in `mueble`.

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

**The room must stay quieter than the furniture.** Wall and floor set `envMapIntensity` to 0.12
and mark `userData.entornoFijo`, which `ajustarEntorno()` honours — that pass runs after the
room is built and used to overwrite the setting, leaving a wall that lit up brighter than the
cabinet it was supposed to sit behind.

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

### The `···` menu

What does not fit in the top bar: *Nuevo tema*, *Varias lecturas*, export/import, and the user plus logout. Search, the status filters and *Añadir libro* moved up to the bar with the Figma design; the menu kept the rest. The sidebar itself — theme list, five stat counters, filter row, the stacked status bar, the backup block — was deleted in the cut of 2026-09-26, because the wall already says most of it: the shelves **are** the theme list, each with its own count, and the legend above the canvas carries the three status totals.

Two things that are easy to get wrong here:

- **`hidden` needs `!important`.** `.menu-panel` is `display: flex`, and any author `display` rule beats the UA stylesheet's `[hidden] { display: none }`. The panel therefore opened on load until `[hidden] { display: none !important; }` went into the reset. The JS uses the attribute as its only switch, so that rule is what makes the switch work at all.
- **The offline banner is `position: fixed` and 48px tall.** It used to cover only the sidebar's title, which nobody missed; now the legend and the `···` button live up there. `mostrarBannerOffline()` / `ocultarBannerOffline()` toggle `body.con-banner`, and the shell answers with `margin-top` plus a shorter `height`. `--alto-banner` is the single source of that 48.

There is no analysis panel, no timeline and no charts. `js/charts.js` is gone; its only survivor is `token()`, which moved to the top of `js/estante3d.js`. If a chart is ever wanted again, read the note in "The 3D shelf" about what the wall already encodes before rebuilding one that repeats it.