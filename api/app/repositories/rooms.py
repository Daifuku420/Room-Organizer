"""All SQL for rooms lives here. Routers never write SQL; services never learn
about asyncpg record types beyond what this module returns."""

import asyncpg

from ..schemas import WallInput


async def list_for_workspace(conn: asyncpg.Connection, workspace_id: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id::text, name, ceiling_kind::text, ceiling_height_mm, updated_at
          FROM room
         WHERE workspace_id = $1
      ORDER BY updated_at DESC
        """,
        workspace_id,
    )
    return [dict(r) for r in rows]


async def create(
    conn: asyncpg.Connection,
    workspace_id: str,
    name: str,
    ceiling_kind: str,
    ceiling_height_mm: int,
    ceiling_low_mm: int | None,
    ceiling_slope_ddeg: int | None,
) -> dict:
    row = await conn.fetchrow(
        """
        INSERT INTO room (workspace_id, name, ceiling_kind, ceiling_height_mm,
                          ceiling_low_mm, ceiling_slope_ddeg)
             VALUES ($1, $2, $3::ceiling_kind, $4, $5, $6)
          RETURNING id::text, name, ceiling_kind::text, ceiling_height_mm, updated_at
        """,
        workspace_id, name, ceiling_kind, ceiling_height_mm,
        ceiling_low_mm, ceiling_slope_ddeg,
    )
    return dict(row)


async def get(conn: asyncpg.Connection, workspace_id: str, room_id: str) -> dict | None:
    row = await conn.fetchrow(
        """
        SELECT id::text, name, ceiling_kind::text, ceiling_height_mm, updated_at
          FROM room
         WHERE id = $1 AND workspace_id = $2
        """,
        room_id, workspace_id,
    )
    return dict(row) if row else None


async def walls_for_room(conn: asyncpg.Connection, room_id: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id::text, seq, x1_mm, y1_mm, x2_mm, y2_mm, thickness_mm
          FROM wall
         WHERE room_id = $1
      ORDER BY seq
        """,
        room_id,
    )
    return [dict(r) for r in rows]


async def replace_walls(
    conn: asyncpg.Connection, room_id: str, walls: list[WallInput]
) -> None:
    """Geometry is replaced wholesale, not patched. A scan produces a complete
    shell, and partial updates would let the loop end up non-closed."""
    async with conn.transaction():
        await conn.execute("DELETE FROM wall WHERE room_id = $1", room_id)
        await conn.executemany(
            """
            INSERT INTO wall (room_id, seq, x1_mm, y1_mm, x2_mm, y2_mm, thickness_mm)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            [
                (room_id, i, w.x1_mm, w.y1_mm, w.x2_mm, w.y2_mm, w.thickness_mm)
                for i, w in enumerate(walls)
            ],
        )
        await conn.execute("UPDATE room SET updated_at = now() WHERE id = $1", room_id)
