"""SQL for browsing the furniture catalog.

Unlike rooms, openings and wall features, the catalog is not scoped to a
workspace — it's shared reference data every paired device can browse. So
these queries don't join back to workspace_id; any current_device caller can
read them.
"""

import asyncpg

_COLS = """
    c.id::text, s.name AS source, c.name, c.category, c.brand,
    c.width_mm, c.depth_mm, c.height_mm, c.price_cents, c.currency,
    c.clearance_front_mm
"""


async def search(
    conn: asyncpg.Connection, q: str | None, category: str | None
) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT {_COLS}
          FROM catalog_item c
          JOIN catalog_source s ON s.id = c.source_id
         WHERE c.discontinued_at IS NULL
           AND ($1::text IS NULL OR c.category = $1)
           AND (
             $2::text IS NULL
             OR to_tsvector('simple', c.name || ' ' || coalesce(c.brand, ''))
                @@ plainto_tsquery('simple', $2)
           )
      ORDER BY c.name
         LIMIT 200
        """,
        category, q,
    )
    return [dict(r) for r in rows]


async def list_categories(conn: asyncpg.Connection) -> list[str]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT category FROM catalog_item
         WHERE discontinued_at IS NULL
      ORDER BY category
        """
    )
    return [r["category"] for r in rows]
