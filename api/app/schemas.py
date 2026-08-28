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
