# Room Planner — state of play

Personal project: plan a room reorganisation on a desktop app, eventually fed
by a phone scanner and a furniture catalogue. Built end of August 2026.

## What runs today

**Server** — Hetzner CX23 (Falkenstein, Germany), Ubuntu 24.04, ~€8/month with
backups. Root login disabled, key-only SSH, fail2ban, unattended-upgrades,
Hetzner network firewall allowing only 22/80/443.

**Stack** — Docker Compose with three services:

| Service | What |
|---|---|
| `caddy` | TLS termination, automatic Let's Encrypt certs, the only container with published ports |
| `api` | FastAPI + asyncpg, runs `alembic upgrade head` then uvicorn |
| `db` | PostgreSQL 17, no published port, reachable only on the internal network |

Live at `https://api.paul-padovani-thomas.com`. Interactive docs at `/docs`.

**Desktop app** — Tauri 2 + React + TypeScript, SVG floor plan drawn in
millimetres. Connects with a device token, browses rooms, edits a plan.

## Features finished

- **Device pairing without accounts.** A bootstrap secret creates the first
  workspace and a desktop token; a 6-digit code (10 min, single use) enrols a
  phone later. Tokens are stored as SHA-256 only.
- **Rooms and wall loops.** Rectangular for now, typed in by hand. Geometry is
  replaced wholesale, never patched.
- **Furniture placement** with drag, snap to 1 cm, rotation, lock, and per-piece
  dimension overrides.
- **Collision detection** that returns the overlap *polygon*, not a boolean, so
  the plan can hatch exactly the region that does not fit.
- **Doors, windows and passages.** Cut out of the wall with an SVG mask. Doors
  draw their swing as a quarter-disc sector; furniture standing in that sector
  is flagged in both inspectors.
- **Wall fittings** (radiators, sockets, switches, vents, pipes). Same shape
  as openings — hang off a wall, drawn on the inward face — plus a
  `clearance_mm` zone in front that flags furniture standing in it, using the
  same obstruction check a door's swing does.
- **Live cotation.** Selecting a piece draws dimension strings to all four
  walls, with the 45° ticks architects use instead of arrowheads.
- **Zoom, pan, fit to room.** Line weights scale with zoom so the drawing keeps
  a constant apparent weight.
- **Alembic migrations.** One revision so far: `0001_baseline`.
- **A first test suite.** `geometry.ts` has Vitest coverage (`npm test`, in
  `desktop/`) — the pure collision/clipping/door-swing/clearance maths.

Not actually built yet, despite once being listed here: catalogue browsing.
The `catalog_source` / `catalog_item` / `catalog_variant` tables exist and
`catalog_item` has a trigram search index, but there is no API for them, no
CSV importer script, and no desktop screen. See "Schema tables with no API
yet" below.

## Decisions worth not re-litigating

**Millimetres as integers, everywhere.** Columns and wire fields end in `_mm`,
angles are tenths of a degree (`_ddeg`), money is cents. No floats in geometry —
rounding drift shows up as furniture that almost fits. Convert to centimetres at
the UI boundary only.

**Layering.** Routers never write SQL. Repositories never import FastAPI.
`geometry.ts` imports nothing at all — it holds the only real logic in the
frontend, so it must be testable without a browser or a server.

**Ownership enforced in SQL.** Every query joins back to `room.workspace_id`
rather than checking in Python. One place to get right instead of six.

**Meshes are never re-hosted.** The database stores product metadata and the
*URL* of a mesh; clients fetch from the vendor CDN and cache locally. This is
both the legally defensible design and the one that costs nothing in storage.
Do not bulk-download GLBs onto the server.

**Placement dimensions are copied from the catalogue, not referenced.** A saved
plan must not change shape because a vendor revised a product page.

**Local edits, then one commit.** Dragging updates React state only; a single
PATCH fires on pointer release. Never one request per pointermove.

**No CORS middleware.** The desktop client makes HTTP calls from Rust via
Tauri's http plugin, so no browser origin is involved. Allowed hosts are pinned
in `src-tauri/capabilities/default.json`.

**No autogenerate in Alembic.** There are no SQLAlchemy models to diff against;
migrations are hand-written with `op.execute()` and plain SQL. That keeps the
schema readable rather than turning it into Python object graphs.

## Schema tables with no API yet

- `scan`, `scan_photo` — for the phone app.
- `catalog_source`, `catalog_item`, `catalog_variant` — the furniture
  catalogue. Seeded with three sources; `catalog_item` has a trigram search
  index ready to use. No router, no repository, no CSV importer, no desktop
  screen. This is the natural next build — the catalogue browse/search API,
  a desktop panel for it, and wiring a pick into placement creation (right
  now `catalog_item_id` on a placement is always null).

## Known gaps

- **Replacing a room's walls cascade-deletes its openings and its wall
  features.** Fine while roughing things out, a real problem once the phone
  scanner starts producing new shells. Worth solving before that lands.
- **Rectangular rooms only.** The schema handles arbitrary wall loops and the
  renderer draws them; there is just no UI to create one.
- **Sloped ceilings are stored but never used.** No 3D view to show them in.
- **The catalogue has no data path at all yet.** Tables exist (see "Schema
  tables with no API yet") but nothing populates them — no importer script,
  no CSV, no scraper. That has to be built alongside the API and desktop UI,
  not bolted on after.
- **Backups are disk snapshots only.** `scripts/backup.sh` does a nightly
  `pg_dump` but is not yet in cron, and nothing copies it off the server.
- **Only `geometry.ts` has tests.** Everything else — repositories, routers,
  the rest of the desktop components — is still uncovered.

## Deploying

```bash
# server
cd ~/room-planner && git pull && docker compose up -d --build
```

Migrations run at container start, so that one line is the whole deploy. If a
migration fails the container exits rather than serving against a schema it does
not expect.

```powershell
# laptop
cd C:\dev\room-planner\desktop
npm run app          # dev with hot reload
npm run app:build    # .msi and .exe installers
```

## Things that bit us

- `openssl rand -base64 32` produces `/` and `+`, which break a Postgres
  connection URL. Use `-hex`.
- Vite must ignore `**/src-tauri/**` or cargo's build output locks binaries
  mid-write on Windows and kills the dev server.
- `UPDATE ... FROM` with joins needs table-qualified columns in `RETURNING`, or
  Postgres rejects `id` as ambiguous.
- `height: 100%` on an SVG inside a grid item resolves against a
  content-derived height and overflows. Use `position: absolute; inset: 0`.
