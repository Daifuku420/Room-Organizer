"""Wire formats. Dimensions cross the wire in MILLIMETRES, like the database.
Converting to centimetres is a presentation concern and belongs in the clients."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BootstrapRequest(BaseModel):
    secret: str
    workspace_name: str = Field(min_length=1, max_length=80)
    device_name: str = Field(min_length=1, max_length=80)


class TokenResponse(BaseModel):
    token: str
    device_id: str
    workspace_id: str


class PairingCodeResponse(BaseModel):
    code: str
    expires_at: datetime


class ClaimRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)
    device_name: str = Field(min_length=1, max_length=80)


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    ceiling_kind: Literal["flat", "sloped"] = "flat"
    ceiling_height_mm: int = Field(default=2500, gt=0, le=10_000)
    ceiling_low_mm: int | None = Field(default=None, gt=0, le=10_000)
    ceiling_slope_ddeg: int | None = Field(default=None, ge=0, le=3600)


class RoomSummary(BaseModel):
    id: str
    name: str
    ceiling_kind: str
    ceiling_height_mm: int
    updated_at: datetime


class Wall(BaseModel):
    id: str
    seq: int
    x1_mm: int
    y1_mm: int
    x2_mm: int
    y2_mm: int
    thickness_mm: int


class WallInput(BaseModel):
    x1_mm: int
    y1_mm: int
    x2_mm: int
    y2_mm: int
    thickness_mm: int = Field(default=100, gt=0, le=1000)


class RoomDetail(RoomSummary):
    walls: list[Wall]
    # Openings are returned with the room rather than behind their own request:
    # the plan cannot be drawn without them, so a second round trip buys nothing.
    openings: list["Opening"] = []


# --- layouts & placements ---------------------------------------------------


class LayoutCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_default: bool = False


class LayoutSummary(BaseModel):
    id: str
    room_id: str
    name: str
    is_default: bool
    updated_at: datetime


class PlacementCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    x_mm: int
    y_mm: int
    z_mm: int = 0
    rotation_ddeg: int = Field(default=0, ge=0, le=3600)
    width_mm: int = Field(gt=0, le=20_000)
    depth_mm: int = Field(gt=0, le=20_000)
    height_mm: int = Field(gt=0, le=10_000)
    catalog_item_id: str | None = None


class PlacementPatch(BaseModel):
    """Every field optional: the editor sends only what the drag changed."""

    label: str | None = Field(default=None, min_length=1, max_length=120)
    x_mm: int | None = None
    y_mm: int | None = None
    z_mm: int | None = None
    rotation_ddeg: int | None = Field(default=None, ge=0, le=3600)
    width_mm: int | None = Field(default=None, gt=0, le=20_000)
    depth_mm: int | None = Field(default=None, gt=0, le=20_000)
    height_mm: int | None = Field(default=None, gt=0, le=10_000)
    locked: bool | None = None


class Placement(BaseModel):
    id: str
    label: str
    x_mm: int
    y_mm: int
    z_mm: int
    rotation_ddeg: int
    width_mm: int
    depth_mm: int
    height_mm: int
    locked: bool
    catalog_item_id: str | None


class LayoutDetail(LayoutSummary):
    placements: list[Placement]


# --- openings ---------------------------------------------------------------


class OpeningCreate(BaseModel):
    kind: Literal["door", "window", "passage"]
    offset_mm: int = Field(ge=0, le=50_000)
    width_mm: int = Field(gt=0, le=10_000)
    sill_mm: int = Field(default=0, ge=0, le=5_000)
    height_mm: int = Field(gt=0, le=5_000)
    swing: Literal["in_left", "in_right", "out_left", "out_right", "sliding", "none"] = "none"


class OpeningPatch(BaseModel):
    offset_mm: int | None = Field(default=None, ge=0, le=50_000)
    width_mm: int | None = Field(default=None, gt=0, le=10_000)
    sill_mm: int | None = Field(default=None, ge=0, le=5_000)
    height_mm: int | None = Field(default=None, gt=0, le=5_000)
    swing: (
        Literal["in_left", "in_right", "out_left", "out_right", "sliding", "none"] | None
    ) = None
    wall_id: str | None = None


class Opening(BaseModel):
    id: str
    wall_id: str
    kind: str
    offset_mm: int
    width_mm: int
    sill_mm: int
    height_mm: int
    swing: str
