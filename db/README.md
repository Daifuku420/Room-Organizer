# Room planner — phase 0

Server-side foundation: Postgres schema, FastAPI skeleton, Caddy with automatic
HTTPS, all under Docker Compose.

## Layout

    api/app/config.py        settings from environment
    api/app/db.py            asyncpg pool lifecycle
    api/app/security.py      device tokens, bearer auth dependency
    api/app/schemas.py       request/response models
    api/app/repositories/    all SQL lives here
    api/app/routers/         HTTP layer, no SQL
    db/001_schema.sql        applied automatically on first `up`
    caddy/Caddyfile          TLS termination and reverse proxy
    scripts/backup.sh        nightly pg_dump

Routers never write SQL and repositories never import FastAPI. Keeping that
boundary is what lets you swap Postgres for something else, or test the data
layer without an HTTP client.

## Units

Every dimension is an **integer in millimetres**, suffixed `_mm`. Angles are
tenths of a degree (`_ddeg`), money is cents (`_cents`). Floats are never used
for geometry — rounding drift shows up as furniture that almost fits. Convert
to centimetres at the UI boundary only.

## Deploy

    git clone <repo> ~/room-planner && cd ~/room-planner
    cp .env.example .env
    openssl rand -base64 32          # once per secret, paste into .env
    nano .env                        # set API_DOMAIN and ACME_EMAIL too
    docker compose up -d --build
    docker compose logs -f caddy     # watch the certificate get issued

Then check it:

    curl https://$API_DOMAIN/health

## First run

Create the workspace and the desktop's token:

    curl -X POST https://$API_DOMAIN/pairing/bootstrap \
      -H 'content-type: application/json' \
      -d '{"secret":"<BOOTSTRAP_SECRET>","workspace_name":"Home","device_name":"laptop"}'

Save the returned `token`. Then, to pair the phone:

    curl -X POST https://$API_DOMAIN/pairing/code -H 'authorization: Bearer <token>'
    curl -X POST https://$API_DOMAIN/pairing/claim \
      -H 'content-type: application/json' \
      -d '{"code":"123456","device_name":"s21fe"}'

Interactive docs: `https://$API_DOMAIN/docs`

## Migrations

Alembic owns the schema. The API container runs `alembic upgrade head` before
uvicorn starts, so deploying is always:

    git pull && docker compose up -d --build

To change the schema, write a migration by hand:

    docker compose run --rm api alembic revision -m "add clearance to catalog"
    # edit api/alembic/versions/<id>_add_clearance_to_catalog.py
    docker compose up -d --build

There is no `--autogenerate`: the project has no SQLAlchemy models for Alembic
to diff against, so migrations use `op.execute()` with plain SQL. Useful checks:

    docker compose run --rm api alembic current      # what is applied
    docker compose run --rm api alembic history      # every revision
    docker compose run --rm api alembic upgrade head --sql   # dry run
