"""Populate the catalog from a CSV.

Upserts on (source_key, external_id), so re-running updates existing rows
rather than duplicating them — a future scraper would write through this
exact path.

Usage:
    docker compose run --rm api python -m scripts.import_catalog data/catalog.csv
"""

import asyncio
import csv
import sys

import asyncpg

from app.config import settings

REQUIRED_COLS = [
    "source_key", "external_id", "name", "category",
    "width_mm", "depth_mm", "height_mm",
]


async def import_csv(path: str) -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        source_ids = {
            r["key"]: r["id"] for r in await conn.fetch("SELECT id, key FROM catalog_source")
        }

        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            missing = [c for c in REQUIRED_COLS if c not in (reader.fieldnames or [])]
            if missing:
                raise SystemExit(f"{path} is missing columns: {', '.join(missing)}")

            count = 0
            for row in reader:
                source_id = source_ids.get(row["source_key"])
                if source_id is None:
                    raise SystemExit(
                        f"unknown source_key {row['source_key']!r} — add it to "
                        "catalog_source first"
                    )

                await conn.execute(
                    """
                    INSERT INTO catalog_item AS c
                                (source_id, external_id, name, category, brand,
                                 width_mm, depth_mm, height_mm, price_cents, currency,
                                 product_url, thumbnail_url, clearance_front_mm,
                                 last_seen_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                                 COALESCE($10, 'EUR'), $11, $12, COALESCE($13, 0), now())
                    ON CONFLICT (source_id, external_id) DO UPDATE SET
                        name                = EXCLUDED.name,
                        category            = EXCLUDED.category,
                        brand               = EXCLUDED.brand,
                        width_mm            = EXCLUDED.width_mm,
                        depth_mm            = EXCLUDED.depth_mm,
                        height_mm           = EXCLUDED.height_mm,
                        price_cents         = EXCLUDED.price_cents,
                        currency            = EXCLUDED.currency,
                        product_url         = EXCLUDED.product_url,
                        thumbnail_url       = EXCLUDED.thumbnail_url,
                        clearance_front_mm  = EXCLUDED.clearance_front_mm,
                        last_seen_at        = now(),
                        discontinued_at     = NULL
                    """,
                    source_id,
                    row["external_id"],
                    row["name"],
                    row["category"],
                    row.get("brand") or None,
                    int(row["width_mm"]),
                    int(row["depth_mm"]),
                    int(row["height_mm"]),
                    int(row["price_cents"]) if row.get("price_cents") else None,
                    row.get("currency") or None,
                    row.get("product_url") or None,
                    row.get("thumbnail_url") or None,
                    int(row["clearance_front_mm"]) if row.get("clearance_front_mm") else None,
                )
                count += 1

        print(f"imported {count} catalog items from {path}")
    finally:
        await conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m scripts.import_catalog <path/to/catalog.csv>")
    asyncio.run(import_csv(sys.argv[1]))
