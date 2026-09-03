# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Room planner: a self-hosted service (FastAPI + Postgres, behind Caddy) plus a
Tauri 2 desktop client (React + TypeScript) that talks to it. No user
accounts — a `workspace` is the unit of ownership, and devices (desktop,
phone) join it via a pairing flow and authenticate with bearer tokens.

## Architecture

```
api/app/config.py        settings from environment (pydantic-settings)
api/app/db.py             asyncpg pool lifecycle
api/app/security.py       device tokens, bearer auth dependency (current_device)
api/app/schemas.py        request/response models (pydantic)
api/app/repositories/     all SQL lives here
api/app/routers/          HTTP layer, no SQL
db/001_schema.sql         hand-written schema (historical reference only, see Migrations)
caddy/Caddyfile           TLS termination and reverse proxy
scripts/backup.sh         nightly pg_dump
desktop/src/geometry.ts   pure plan maths: rotation, clipping, collisions, gaps
desktop/src/api.ts        HTTP client + furniture presets
desktop/src/components/   Setup, RoomList, Editor, FloorPlan, Inspector
```

**Routers never write SQL; repositories never import FastAPI.** This
boundary is deliberate — it lets Postgres be swapped later and lets the data
layer be tested without an HTTP client. When adding an endpoint, put the
query in `api/app/repositories/<thing>.py` and call it from
`api/app/routers/<thing>.py`.

Ownership checks in repositories join up to `room.workspace_id` (e.g.
openings hang off a wall, which hangs off a room — see
`api/app/repositories/openings.py` for the pattern of joining two levels up
and scoping every query by the caller's `workspace_id`). Follow this pattern
for any new child resource.

`desktop/src/geometry.ts` imports nothing — no React, no DOM. Keep it that
way; it's the part of the desktop app with real logic (collision detection,
polygon clipping, door swing arcs) and is meant to be unit-testable in
isolation.

## Units (critical, cross-cutting convention)

Every dimension is an **integer in millimetres**, suffixed `_mm`. Angles are
integers in **tenths of a degree**, suffixed `_ddeg` (3600 = 360°). Money is
integer **cents**, suffixed `_cents`. Never use floats for geometry —
rounding drift shows up as furniture that "almost" fits. Convert to
centimetres only at the UI boundary. This convention spans the DB schema,
API schemas, and desktop TypeScript types — keep new fields consistent with
it.

Room coordinates: 2D floor-plan coordinates in mm, origin at the room's
bottom-left bounding corner, +x right, +y up (mathematical, not screen — the
SVG layer in `FloorPlan.tsx` does the y-flip). Polygons must be wound
counter-clockwise (`ensureCCW` in `geometry.ts`) for the half-plane tests in
the Sutherland–Hodgman clipper to hold.

## Migrations

**Alembic owns the schema now** — `db/001_schema.sql` is no longer mounted
as an init script (see the comment in `docker-compose.yml`) and is kept only
as historical reference for the original schema design and its comments.
The API container runs `alembic upgrade head` before uvicorn starts
(`api/entrypoint.sh`), so a deploy is always `git pull && docker compose up
-d --build`.

There are **no SQLAlchemy models** — migrations are hand-written
`op.execute()` SQL, and `--autogenerate` will not work:

```
docker compose run --rm api alembic revision -m "add clearance to catalog"
# edit api/alembic/versions/<id>_add_clearance_to_catalog.py
docker compose up -d --build

docker compose run --rm api alembic current            # what is applied
docker compose run --rm api alembic history             # every revision
docker compose run --rm api alembic upgrade head --sql   # dry run, prints SQL
```

## Running / building

Server stack (Postgres, FastAPI, Caddy — all in Docker):

```
cp .env.example .env
openssl rand -base64 32          # once per secret, paste into .env
docker compose up -d --build
docker compose logs -f caddy     # watch the TLS cert get issued
curl https://$API_DOMAIN/health
```

First-run bootstrap (creates the workspace + desktop token, then pairs a
second device):

```
curl -X POST https://$API_DOMAIN/pairing/bootstrap \
  -H 'content-type: application/json' \
  -d '{"secret":"<BOOTSTRAP_SECRET>","workspace_name":"Home","device_name":"laptop"}'

curl -X POST https://$API_DOMAIN/pairing/code -H 'authorization: Bearer <token>'
curl -X POST https://$API_DOMAIN/pairing/claim \
  -H 'content-type: application/json' \
  -d '{"code":"123456","device_name":"s21fe"}'
```

Interactive API docs: `https://$API_DOMAIN/docs`.

Desktop app (`cd desktop`):

```
npm install
npm run tauri icon    # regenerate src-tauri/icons from a square PNG
npm run app           # tauri dev, hot reload
npm run app:build     # produces .msi / .exe installers
npm run build          # tsc --noEmit && vite build (type-check + web build)
npm test               # vitest run — geometry.ts only, for now
```

Requires Rust + MSVC build tools (`winget install Rustlang.Rustup`,
`winget install Microsoft.VisualStudio.2022.BuildTools`, "Desktop
development with C++" workload). WebView2 ships with Windows 11.

Only `geometry.ts` has tests (`geometry.test.ts`, via Vitest) — it's the one
file with real logic and no React/DOM dependency, so it's the cheapest to
cover. Nothing else in the repo has a test suite.

## Networking notes

- The API has **no CORS middleware** on purpose: the desktop makes HTTP
  calls through Tauri's Rust-side http plugin, not the webview, so no
  browser origin is ever involved. Don't add CORS to widen this.
- Reachable hosts for the desktop client are pinned in
  `desktop/src-tauri/capabilities/default.json`. If the API's domain
  changes, update the `http:default` allow list there.
- Only Caddy exposes ports (80/443). Postgres and the API are reachable only
  on the compose-internal network.

## Auth model

Bearer tokens are 32 random bytes, base64url-encoded, shown to the client
exactly once; only the SHA-256 digest is stored (`api/app/security.py`).
There are no passwords or user accounts — trust boundary is the workspace,
established once via `BOOTSTRAP_SECRET` and extended via 6-digit pairing
codes (10-minute TTL, single-claim). Use `secrets.compare_digest` for any
future secret comparison, not `==`.

## Other design decisions worth not re-litigating

- **Ownership enforced in SQL, not Python.** Every query joins back to
  `room.workspace_id` rather than checking access in the router. One place
  to get right instead of several — see `api/app/repositories/openings.py`.
- **Local edits, then one commit.** Dragging a placement in `FloorPlan.tsx`
  updates React state only; a single `PATCH` fires on pointer release, never
  one request per `pointermove`.
- **Replacing a room's walls cascade-deletes its openings** (FK `ON DELETE
  CASCADE` from `opening.wall_id` to `wall.id`). Fine today since walls are
  typed in by hand and replaced wholesale; will need a real migration story
  once a phone scanner starts producing new shells for existing rooms.

## Schema tables with no API yet

`scan` / `scan_photo` (for a future phone-scanning client), and
`catalog_source` / `catalog_item` / `catalog_variant` (the furniture
catalogue — seeded with three sources but nothing reads or writes
items/variants yet: no router, no repository, no CSV importer, no desktop
screen, despite the DB having a trigram search index on `catalog_item`
ready to use). These exist only in `api/alembic/versions/0001_baseline.py`.

`wall_feature` (radiators/sockets/switches/vents, with a `clearance_mm`
column) now has a full API (`api/app/repositories/wall_features.py`,
`api/app/routers/wall_features.py`) and desktop UI (`FeatureInspector` in
`Inspector.tsx`, rendering in `FloorPlan.tsx`), built the same way
`openings.py` was — including a clearance obstruction check
(`featureClearancePolygon` in `geometry.ts`) that plugs into the same
`findObstructions` a door's swing uses, generalized to a
`{kind: "opening"|"feature", id}` source.

## Gotchas

- `openssl rand -base64 32` can produce `/` and `+`, which break a Postgres
  connection URL — prefer `-hex` for anything going into `DATABASE_URL`.
- Vite's dev server must ignore `**/src-tauri/**` (already set in
  `vite.config.ts`): Cargo writes thousands of files there during a build,
  and watching them locks binaries mid-write on Windows and kills the dev
  server.
- `UPDATE ... FROM` with a join needs table-qualified columns in
  `RETURNING`, or Postgres rejects `id` as ambiguous — see the patch queries
  in `api/app/repositories/openings.py` and `layouts.py` for the pattern.
