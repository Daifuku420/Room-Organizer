"""SQL for wall features — radiators, sockets, switches, vents, pipes.

Wall features hang off a wall, and walls hang off a room, so ownership checks
join two levels up to room.workspace_id. Note that replacing a room's walls
deletes its features by cascade: a rescan produces a new shell, and keeping
features pinned to walls that no longer exist would be worse than losing them.
"""

import asyncpg

from ..schemas import WallFeatureCreate, WallFeaturePatch

_COLS = """
    f.id::text, f.wall_id::text, f.kind::text, f.label, f.offset_mm,
    f.width_mm, f.z_mm, f.height_mm, f.depth_mm, f.clearance_mm
"""


async def list_for_room(conn: asyncpg.Connection, room_id: str) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT {_COLS}
          FROM wall_feature f
          JOIN wall w ON w.id = f.wall_id
         WHERE w.room_id = $1
      ORDER BY w.seq, f.offset_mm
        """,
        room_id,
    )
    return [dict(r) for r in rows]


async def create(
    conn: asyncpg.Connection, workspace_id: str, wall_id: str, body: WallFeatureCreate
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
        INSERT INTO wall_feature AS f
                    (wall_id, kind, label, offset_mm, width_mm, z_mm,
                     height_mm, depth_mm, clearance_mm)
             VALUES ($1, $2::feature_kind, $3, $4, $5, $6, $7, $8, $9)
          RETURNING {_COLS}
        """,
        wall_id, body.kind, body.label, body.offset_mm, body.width_mm,
        body.z_mm, body.height_mm, body.depth_mm, body.clearance_mm,
    )
    return dict(row)


async def patch(
    conn: asyncpg.Connection, workspace_id: str, feature_id: str, body: WallFeaturePatch
) -> dict | None:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return await get(conn, workspace_id, feature_id)

    casts = {"wall_id": "::uuid"}
    assignments = ", ".join(
        f"{col} = ${i + 3}{casts.get(col, '')}" for i, col in enumerate(fields)
    )

    row = await conn.fetchrow(
        f"""
        UPDATE wall_feature f SET {assignments}
          FROM wall w JOIN room r ON r.id = w.room_id
         WHERE f.id = $1 AND f.wall_id = w.id AND r.workspace_id = $2
     RETURNING {_COLS}
        """,
        feature_id, workspace_id, *fields.values(),
    )
    return dict(row) if row else None


async def get(
    conn: asyncpg.Connection, workspace_id: str, feature_id: str
) -> dict | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_COLS}
          FROM wall_feature f
          JOIN wall w ON w.id = f.wall_id
          JOIN room r ON r.id = w.room_id
         WHERE f.id = $1 AND r.workspace_id = $2
        """,
        feature_id, workspace_id,
    )
    return dict(row) if row else None


async def delete(conn: asyncpg.Connection, workspace_id: str, feature_id: str) -> bool:
    deleted = await conn.fetchval(
        """
        DELETE FROM wall_feature f
         USING wall w JOIN room r ON r.id = w.room_id
         WHERE f.id = $1 AND f.wall_id = w.id AND r.workspace_id = $2
     RETURNING 1
        """,
        feature_id, workspace_id,
    )
    return bool(deleted)
