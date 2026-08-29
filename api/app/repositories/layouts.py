"""SQL for layouts and placements.

Ownership is enforced in SQL rather than in Python: every query joins back to
room.workspace_id, so a caller cannot reach another workspace's data even if a
router forgets to check. One place to get right instead of six.
"""

import asyncpg

from ..schemas import PlacementCreate, PlacementPatch

_PLACEMENT_COLS = """
    p.id::text, p.label, p.x_mm, p.y_mm, p.z_mm, p.rotation_ddeg,
    p.width_mm, p.depth_mm, p.height_mm, p.locked, p.catalog_item_id::text
"""

# Same list, table-qualified. Queries that join layout and room must use this:
# unqualified "id" would be ambiguous across three tables and Postgres rejects it.
_PLACEMENT_COLS_Q = """
    p.id::text, p.label, p.x_mm, p.y_mm, p.z_mm, p.rotation_ddeg,
    p.width_mm, p.depth_mm, p.height_mm, p.locked, p.catalog_item_id::text
"""


async def list_for_room(
    conn: asyncpg.Connection, workspace_id: str, room_id: str
) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT l.id::text, l.room_id::text, l.name, l.is_default, l.updated_at
          FROM layout l
          JOIN room r ON r.id = l.room_id
         WHERE l.room_id = $1 AND r.workspace_id = $2
      ORDER BY l.is_default DESC, l.updated_at DESC
        """,
        room_id, workspace_id,
    )
    return [dict(r) for r in rows]


async def create(
    conn: asyncpg.Connection, workspace_id: str, room_id: str, name: str, is_default: bool
) -> dict | None:
    async with conn.transaction():
        owned = await conn.fetchval(
            "SELECT 1 FROM room WHERE id = $1 AND workspace_id = $2", room_id, workspace_id
        )
        if not owned:
            return None

        if is_default:
            # The partial unique index allows only one default per room, so the
            # old one must be cleared inside the same transaction.
            await conn.execute(
                "UPDATE layout SET is_default = false WHERE room_id = $1", room_id
            )

        row = await conn.fetchrow(
            """
            INSERT INTO layout (room_id, name, is_default) VALUES ($1, $2, $3)
              RETURNING id::text, room_id::text, name, is_default, updated_at
            """,
            room_id, name, is_default,
        )
    return dict(row)


async def get(conn: asyncpg.Connection, workspace_id: str, layout_id: str) -> dict | None:
    row = await conn.fetchrow(
        """
        SELECT l.id::text, l.room_id::text, l.name, l.is_default, l.updated_at
          FROM layout l
          JOIN room r ON r.id = l.room_id
         WHERE l.id = $1 AND r.workspace_id = $2
        """,
        layout_id, workspace_id,
    )
    return dict(row) if row else None


async def placements_for_layout(conn: asyncpg.Connection, layout_id: str) -> list[dict]:
    rows = await conn.fetch(
        f"SELECT {_PLACEMENT_COLS} FROM placement p WHERE p.layout_id = $1 ORDER BY p.created_at",
        layout_id,
    )
    return [dict(r) for r in rows]


async def add_placement(
    conn: asyncpg.Connection, layout_id: str, body: PlacementCreate
) -> dict:
    row = await conn.fetchrow(
        f"""
        INSERT INTO placement AS p (layout_id, label, x_mm, y_mm, z_mm, rotation_ddeg,
                               width_mm, depth_mm, height_mm, catalog_item_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING {_PLACEMENT_COLS}
        """,
        layout_id, body.label, body.x_mm, body.y_mm, body.z_mm, body.rotation_ddeg,
        body.width_mm, body.depth_mm, body.height_mm, body.catalog_item_id,
    )
    return dict(row)


async def patch_placement(
    conn: asyncpg.Connection, workspace_id: str, placement_id: str, body: PlacementPatch
) -> dict | None:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        fields = {}

    # Build the SET clause from whatever the client actually sent. Column names
    # come from the pydantic model, never from raw request keys, so there is no
    # injection surface here.
    assignments = ", ".join(f"{col} = ${i + 3}" for i, col in enumerate(fields))
    set_clause = f"SET {assignments}" if assignments else "SET label = p.label"

    row = await conn.fetchrow(
        f"""
        UPDATE placement p {set_clause}
          FROM layout l JOIN room r ON r.id = l.room_id
         WHERE p.id = $1 AND p.layout_id = l.id AND r.workspace_id = $2
     RETURNING {_PLACEMENT_COLS_Q}
        """,
        placement_id, workspace_id, *fields.values(),
    )
    return dict(row) if row else None


async def delete_placement(
    conn: asyncpg.Connection, workspace_id: str, placement_id: str
) -> bool:
    deleted = await conn.fetchval(
        """
        DELETE FROM placement p
         USING layout l JOIN room r ON r.id = l.room_id
         WHERE p.id = $1 AND p.layout_id = l.id AND r.workspace_id = $2
     RETURNING 1
        """,
        placement_id, workspace_id,
    )
    return bool(deleted)
