# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this project

A single-page application (vanilla JS, no framework, no build step) to track reading progress through Gabriel García Márquez's 18 works. Uses Supabase for cloud persistence and localStorage as offline fallback.

## Running locally

No build process. Open `index.html` directly in a browser, or serve via HTTP for OAuth redirects to work:

```bash
python -m http.server 8000
# or
npx serve
```

## Architecture

Pure client-side SPA. JS files must load in this order (as declared in `index.html`):

```
supabase.js → data.js → charts.js → db.js → auth.js → app.js
```

**File responsibilities:**
- `js/data.js` — Static catalog of 18 books (`librosOriginales` array). Source of truth for book metadata.
- `js/supabase.js` — Initializes Supabase client. Credentials are hardcoded (anon key only — intentional).
- `js/auth.js` — OAuth flows (GitHub & Google via Supabase). Manages session and triggers app initialization.
- `js/db.js` — CRUD operations against the `lecturas_usuario` Supabase table.
- `js/app.js` — All UI logic: state, filters, rendering, modal, timeline, date calculations.
- `js/charts.js` — Chart.js visualizations (status pie chart, pages-per-month bar chart).

## Data persistence

Dual-layer persistence in this priority order:
1. **Supabase** (`lecturas_usuario` table) — when user is authenticated
2. **localStorage** (`gaboLecturas` key) — fallback / offline cache

On login, the app migrates any existing localStorage data to Supabase (`migrarDesdeLocalStorage()`).

## Database schema

Table: `lecturas_usuario` (defined in `supabase-schema.sql`)

Key columns: `user_id`, `libro_id` (0-based index into `librosOriginales`), `estado` (`'Leído'|'Leyendo'|'Pendiente'`), `inicio`/`final` (dates as `DD/mes/YYYY` strings in Spanish), `dias`, `portada` (cached Google Books URL), `comentarios`.

Unique constraint on `(user_id, libro_id)`. RLS ensures users only access their own rows.

## Date format

All dates stored and parsed as Spanish strings: `DD/mes/YYYY` (e.g., `15/marzo/2024`). Month names are in Spanish only — any date parsing logic must account for this.

## CSS design system

CSS variables in `styles.css`. State colors: Leído → green, Leyendo → yellow, Pendiente → purple. Responsive breakpoints: >1024px (3-col grid), 768-1024px (2-col), <768px (1-col).
