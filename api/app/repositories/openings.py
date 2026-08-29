"""SQL for wall openings — doors, windows, passages.

Openings hang off a wall, and walls hang off a room, so ownership checks join
two levels up to room.workspace_id. Note that replacing a room's walls deletes
its openings by cascade: a rescan produces a new shell, and keeping openings
pinned to walls that no longer exist would be worse than losing them.
"""

import asyncpg

from ..schemas import OpeningCreate, OpeningPatch

_COLS = """
    o.id::text, o.wall_id::text, o.kind::text, o.offset_mm,
    o.width_mm, o.sill_mm, o.height_mm, o.swing::text
"""


async def list_for_room(conn: asyncpg.Connection, room_id: str) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT {_COLS}
          FROM opening o
          JOIN wall w ON w.id = o.wall_id
         WHERE w.room_id = $1
      ORDER BY w.seq, o.offset_mm
        """,
        room_id,
    )
    return [dict(r) for r in rows]


async def create(
    conn: asyncpg.Connection, workspace_id: str, wall_id: str, body: OpeningCreate
) -> dict | None:
    owned = await conn.fetchval(
        """
        SELECT 1 FROM wall w JOIN room r ON r.id = w.room_id
         WHERE w.id = $1 AND r.workspace_id = $2
        """,
        wall_id, workspace_id,
    )
    if not owned:
        return None

    row = await conn.fetchrow(
        f"""
        INSERT INTO opening AS o
                    (wall_id, kind, offset_mm, width_mm, sill_mm, height_mm, swing)
             VALUES ($1, $2::opening_kind, $3, $4, $5, $6, $7::swing_dir)
          RETURNING {_COLS}
        """,
        wall_id, body.kind, body.offset_mm, body.width_mm,
        body.sill_mm, body.height_mm, body.swing,
    )
    return dict(row)


async def patch(
    conn: asyncpg.Connection, workspace_id: str, opening_id: str, body: OpeningPatch
) -> dict | None:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get(conn, workspace_id, opening_id)

    casts = {"swing": "::swing_dir", "wall_id": "::uuid"}
    assignments = ", ".join(
        f"{col} = ${i + 3}{casts.get(col, '')}" for i, col in enumerate(fields)
    )

    row = await conn.fetchrow(
        f"""
        UPDATE opening o SET {assignments}
          FROM wall w JOIN room r ON r.id = w.room_id
         WHERE o.id = $1 AND o.wall_id = w.id AND r.workspace_id = $2
     RETURNING {_COLS}
        """,
        opening_id, workspace_id, *fields.values(),
    )
    return dict(row) if row else None


async def get(
    conn: asyncpg.Connection, workspace_id: str, opening_id: str
) -> dict | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_COLS}
          FROM opening o
          JOIN wall w ON w.id = o.wall_id
          JOIN room r ON r.id = w.room_id
         WHERE o.id = $1 AND r.workspace_id = $2
        """,
        opening_id, workspace_id,
    )
    return dict(row) if row else None


async def delete(conn: asyncpg.Connection, workspace_id: str, opening_id: str) -> bool:
    deleted = await conn.fetchval(
        """
        DELETE FROM opening o
         USING wall w JOIN room r ON r.id = w.room_id
         WHERE o.id = $1 AND o.wall_id = w.id AND r.workspace_id = $2
     RETURNING 1
        """,
        opening_id, workspace_id,
    )
    return bool(deleted)
