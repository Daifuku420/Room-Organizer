"""Add category to placement.

Copied onto the placement at creation time from the catalog item, the same
way width_mm/depth_mm/height_mm already are — a saved plan shouldn't change
how it's drawn because a vendor recategorized a product later. The desktop
client uses it to pick which glyph to draw a piece as; hand-entered pieces
just leave it null and render as a plain box, like today.

Revision ID: 0002_placement_category
Revises: 0001_baseline
"""

from alembic import op

revision = "0002_placement_category"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE placement ADD COLUMN category text")


def downgrade() -> None:
    op.execute("ALTER TABLE placement DROP COLUMN category")
