from fastapi import APIRouter, Depends, HTTPException, status

from ..db import connection
from ..repositories import layouts as repo
from ..schemas import (
    LayoutCreate,
    LayoutDetail,
    LayoutSummary,
    Placement,
    PlacementCreate,
    PlacementPatch,
)
from ..security import Caller, current_device

router = APIRouter(tags=["layouts"])


@router.get("/rooms/{room_id}/layouts", response_model=list[LayoutSummary])
async def list_layouts(room_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        return await repo.list_for_room(conn, caller.workspace_id, room_id)


@router.post(
    "/rooms/{room_id}/layouts",
    response_model=LayoutSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_layout(
    room_id: str, body: LayoutCreate, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        layout = await repo.create(
            conn, caller.workspace_id, room_id, body.name, body.is_default
        )
    if layout is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such room")
    return layout


@router.get("/layouts/{layout_id}", response_model=LayoutDetail)
async def get_layout(layout_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        layout = await repo.get(conn, caller.workspace_id, layout_id)
        if layout is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such layout")
        layout["placements"] = await repo.placements_for_layout(conn, layout_id)
    return layout


@router.post(
    "/layouts/{layout_id}/placements",
    response_model=Placement,
    status_code=status.HTTP_201_CREATED,
)
async def add_placement(
    layout_id: str, body: PlacementCreate, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        if await repo.get(conn, caller.workspace_id, layout_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such layout")
        return await repo.add_placement(conn, layout_id, body)


@router.patch("/placements/{placement_id}", response_model=Placement)
async def patch_placement(
    placement_id: str, body: PlacementPatch, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        row = await repo.patch_placement(conn, caller.workspace_id, placement_id, body)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such placement")
    return row


@router.delete("/placements/{placement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_placement(placement_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        if not await repo.delete_placement(conn, caller.workspace_id, placement_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such placement")
