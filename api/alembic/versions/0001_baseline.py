"""Baseline: the schema as it stood before Alembic.

This migration creates everything db/001_schema.sql used to create on first
boot. An existing database is brought under version control with

    docker compose run --rm api alembic stamp 0001_baseline

which records this revision as applied WITHOUT running it, leaving the data
alone. A fresh database runs it for real.

Revision ID: 0001_baseline
Revises:
"""

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = r"""
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity: no user accounts. A workspace is the unit of ownership; devices
-- join a workspace by pairing code and authenticate with a bearer token.
-- ---------------------------------------------------------------------------

CREATE TABLE workspace (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE device_kind AS ENUM ('desktop', 'phone');

CREATE TABLE device (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    kind          device_kind NOT NULL,
    name          text        NOT NULL,
    -- sha256 of the bearer token. The plaintext token is shown once, at
    -- creation, and never stored.
    token_sha256  bytea       NOT NULL UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz
);

CREATE INDEX device_workspace_idx ON device(workspace_id);

CREATE TABLE pairing_code (
    code         char(6)     PRIMARY KEY,
    workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    claimed_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Rooms and their geometry
--
-- A room shell is an ordered list of wall segments forming a closed loop.
-- Alcoves need no special type: they are simply extra segments in the loop.
-- ---------------------------------------------------------------------------

CREATE TYPE ceiling_kind AS ENUM ('flat', 'sloped');

CREATE TABLE room (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid         NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name              text         NOT NULL,
    ceiling_kind      ceiling_kind NOT NULL DEFAULT 'flat',
    ceiling_height_mm integer      NOT NULL DEFAULT 2500 CHECK (ceiling_height_mm > 0),
    -- For sloped ceilings: the ceiling falls from ceiling_height_mm down to
    -- ceiling_low_mm along the direction given by ceiling_slope_ddeg.
    ceiling_low_mm    integer      CHECK (ceiling_low_mm IS NULL OR ceiling_low_mm > 0),
    ceiling_slope_ddeg integer     CHECK (ceiling_slope_ddeg IS NULL
                                          OR ceiling_slope_ddeg BETWEEN 0 AND 3600),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT sloped_needs_low CHECK (
        ceiling_kind = 'flat' OR (ceiling_low_mm IS NOT NULL AND ceiling_slope_ddeg IS NOT NULL)
    )
);

CREATE INDEX room_workspace_idx ON room(workspace_id);

CREATE TABLE wall (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id    uuid    NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    seq        integer NOT NULL,          -- position in the closed loop, 0-based
    x1_mm      integer NOT NULL,
    y1_mm      integer NOT NULL,
    x2_mm      integer NOT NULL,
    y2_mm      integer NOT NULL,
    thickness_mm integer NOT NULL DEFAULT 100 CHECK (thickness_mm > 0),
    UNIQUE (room_id, seq)
);

CREATE INDEX wall_room_idx ON wall(room_id);

CREATE TYPE opening_kind AS ENUM ('door', 'window', 'passage');
CREATE TYPE swing_dir    AS ENUM ('in_left', 'in_right', 'out_left', 'out_right', 'sliding', 'none');

CREATE TABLE opening (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id       uuid         NOT NULL REFERENCES wall(id) ON DELETE CASCADE,
    kind          opening_kind NOT NULL,
    -- distance from the wall's (x1,y1) end to the opening's near edge
    offset_mm     integer      NOT NULL CHECK (offset_mm >= 0),
    width_mm      integer      NOT NULL CHECK (width_mm > 0),
    sill_mm       integer      NOT NULL DEFAULT 0 CHECK (sill_mm >= 0),
    height_mm     integer      NOT NULL CHECK (height_mm > 0),
    swing         swing_dir    NOT NULL DEFAULT 'none',
    CONSTRAINT door_swing CHECK (kind <> 'door' OR swing <> 'none')
);

CREATE INDEX opening_wall_idx ON opening(wall_id);

CREATE TYPE feature_kind AS ENUM ('radiator', 'socket', 'switch', 'vent', 'pipe', 'other');

-- Things attached to a wall that constrain placement but are not openings.
CREATE TABLE wall_feature (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id    uuid         NOT NULL REFERENCES wall(id) ON DELETE CASCADE,
    kind       feature_kind NOT NULL,
    label      text,
    offset_mm  integer      NOT NULL CHECK (offset_mm >= 0),
    width_mm   integer      NOT NULL CHECK (width_mm > 0),
    z_mm       integer      NOT NULL CHECK (z_mm >= 0),   -- height above floor
    height_mm  integer      NOT NULL CHECK (height_mm > 0),
    depth_mm   integer      NOT NULL DEFAULT 0 CHECK (depth_mm >= 0),
    -- Free space this feature needs in front of it, e.g. a radiator wants
    -- clearance so a wardrobe does not cook.
    clearance_mm integer    NOT NULL DEFAULT 0 CHECK (clearance_mm >= 0)
);

CREATE INDEX wall_feature_wall_idx ON wall_feature(wall_id);

-- ---------------------------------------------------------------------------
-- Scans: what the phone uploads. Photos live on disk; only metadata here.
-- ---------------------------------------------------------------------------

CREATE TYPE scan_status AS ENUM ('uploading', 'ready', 'failed');

CREATE TABLE scan (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     uuid        NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    device_id   uuid        REFERENCES device(id) ON DELETE SET NULL,
    status      scan_status NOT NULL DEFAULT 'uploading',
    captured_at timestamptz NOT NULL,
    -- ARCore session info, tracking quality, corner confidence, etc.
    meta        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX scan_room_idx ON scan(room_id);

CREATE TABLE scan_photo (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id     uuid  NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
    storage_key text  NOT NULL,   -- path under the media root
    taken_at    timestamptz NOT NULL,
    pose        jsonb          -- camera position/orientation at capture
);

CREATE INDEX scan_photo_scan_idx ON scan_photo(scan_id);

-- ---------------------------------------------------------------------------
-- Catalog
--
-- We store FACTS about products (name, size, price) and URLs. We never store
-- the mesh bytes: clients fetch mesh_url directly from the vendor CDN and
-- cache it locally. See mesh_status for the self-healing 404 flow.
-- ---------------------------------------------------------------------------

CREATE TABLE catalog_source (
    id        smallserial PRIMARY KEY,
    key       text UNIQUE NOT NULL,   -- 'ikea_fr', 'objaverse', 'manual'
    name      text NOT NULL,
    base_url  text,
    enabled   boolean NOT NULL DEFAULT true
);

CREATE TYPE mesh_status AS ENUM ('unknown', 'ok', 'missing', 'blocked');

CREATE TABLE catalog_item (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       smallint NOT NULL REFERENCES catalog_source(id),
    external_id     text     NOT NULL,   -- vendor SKU
    name            text     NOT NULL,
    category        text     NOT NULL,   -- 'bed', 'desk', 'wardrobe', ...
    brand           text,
    width_mm        integer  CHECK (width_mm  > 0),
    depth_mm        integer  CHECK (depth_mm  > 0),
    height_mm       integer  CHECK (height_mm > 0),
    price_cents     integer  CHECK (price_cents >= 0),
    currency        char(3)  NOT NULL DEFAULT 'EUR',
    product_url     text,
    thumbnail_url   text,
    mesh_url        text,
    mesh_format     text,                -- 'glb', 'gltf', 'usdz'
    mesh_status     mesh_status NOT NULL DEFAULT 'unknown',
    mesh_checked_at timestamptz,
    license         text,                -- matters for Objaverse / CC items
    -- Default clearance the category wants, in mm, front/back/left/right.
    clearance_front_mm integer NOT NULL DEFAULT 0,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    discontinued_at timestamptz,
    UNIQUE (source_id, external_id)
);

CREATE INDEX catalog_item_category_idx ON catalog_item(category);
CREATE INDEX catalog_item_search_idx   ON catalog_item
    USING gin (to_tsvector('simple', name || ' ' || coalesce(brand, '')));

CREATE TABLE catalog_variant (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid NOT NULL REFERENCES catalog_item(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    label       text NOT NULL,          -- 'white', 'oak veneer'
    price_cents integer,
    mesh_url    text,
    thumbnail_url text,
    UNIQUE (item_id, external_id)
);

-- ---------------------------------------------------------------------------
-- Layouts: a room can have several competing arrangements.
-- ---------------------------------------------------------------------------

CREATE TABLE layout (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id    uuid    NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    name       text    NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX layout_one_default_per_room
    ON layout(room_id) WHERE is_default;

CREATE TABLE placement (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id       uuid    NOT NULL REFERENCES layout(id) ON DELETE CASCADE,
    -- Either a catalog item, or a hand-entered box with its own dimensions.
    catalog_item_id uuid    REFERENCES catalog_item(id) ON DELETE SET NULL,
    variant_id      uuid    REFERENCES catalog_variant(id) ON DELETE SET NULL,
    label           text    NOT NULL,
    -- Centre of the footprint, in room coordinates.
    x_mm            integer NOT NULL,
    y_mm            integer NOT NULL,
    z_mm            integer NOT NULL DEFAULT 0,   -- >0 for wall-mounted items
    rotation_ddeg   integer NOT NULL DEFAULT 0 CHECK (rotation_ddeg BETWEEN 0 AND 3600),
    -- Override the catalog dimensions, or supply them for a hand-entered box.
    width_mm        integer CHECK (width_mm  > 0),
    depth_mm        integer CHECK (depth_mm  > 0),
    height_mm       integer CHECK (height_mm > 0),
    locked          boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dims_present CHECK (
        catalog_item_id IS NOT NULL
        OR (width_mm IS NOT NULL AND depth_mm IS NOT NULL AND height_mm IS NOT NULL)
    )
);

CREATE INDEX placement_layout_idx ON placement(layout_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER room_touch   BEFORE UPDATE ON room
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER layout_touch BEFORE UPDATE ON layout
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

INSERT INTO catalog_source (key, name, base_url) VALUES
    ('manual',    'Hand-entered',      NULL),
    ('ikea_fr',   'IKEA France',       'https://www.ikea.com/fr/fr/'),
    ('objaverse', 'Objaverse (CC)',    NULL);
"""


def upgrade() -> None:
    op.execute(SCHEMA)


def downgrade() -> None:
    # Reverse dependency order. Dropping the tables takes their indexes,
    # constraints and triggers with them; the enums and the function are
    # standalone and have to go by hand.
    op.execute(
        """
        DROP TABLE IF EXISTS placement, layout, catalog_variant, catalog_item,
                             catalog_source, scan_photo, scan, wall_feature,
                             opening, wall, room, pairing_code, device, workspace
                    CASCADE;
        DROP FUNCTION IF EXISTS touch_updated_at() CASCADE;
        DROP TYPE IF EXISTS mesh_status, feature_kind, swing_dir, opening_kind,
                            scan_status, ceiling_kind, device_kind CASCADE;
        """
    )
