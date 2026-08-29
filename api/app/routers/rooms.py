from fastapi import APIRouter, Depends, HTTPException, status

from ..db import connection
from ..repositories import openings as openings_repo
from ..repositories import rooms as repo
from ..schemas import RoomCreate, RoomDetail, RoomSummary, WallInput
from ..security import Caller, current_device

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("", response_model=list[RoomSummary])
async def list_rooms(caller: Caller = Depends(current_device)):
    async with connection() as conn:
        return await repo.list_for_workspace(conn, caller.workspace_id)


@router.post("", response_model=RoomSummary, status_code=status.HTTP_201_CREATED)
async def create_room(body: RoomCreate, caller: Caller = Depends(current_device)):
    if body.ceiling_kind == "sloped" and (
        body.ceiling_low_mm is None or body.ceiling_slope_ddeg is None
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "sloped ceilings need ceiling_low_mm and ceiling_slope_ddeg",
        )

    async with connection() as conn:
        return await repo.create(
            conn,
            caller.workspace_id,
            body.name,
            body.ceiling_kind,
            body.ceiling_height_mm,
            body.ceiling_low_mm,
            body.ceiling_slope_ddeg,
        )


@router.get("/{room_id}", response_model=RoomDetail)
async def get_room(room_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        room = await repo.get(conn, caller.workspace_id, room_id)
        if room is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such room")
        room["walls"] = await repo.walls_for_room(conn, room_id)
        room["openings"] = await openings_repo.list_for_room(conn, room_id)
    return room


@router.put("/{room_id}/walls", response_model=RoomDetail)
async def replace_walls(
    room_id: str, walls: list[WallInput], caller: Caller = Depends(current_device)
):
    if len(walls) < 3:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "a room needs at least 3 walls"
        )

    async with connection() as conn:
        room = await repo.get(conn, caller.workspace_id, room_id)
        if room is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such room")
        await repo.replace_walls(conn, room_id, walls)
        room = await repo.get(conn, caller.workspace_id, room_id)
        room["walls"] = await repo.walls_for_room(conn, room_id)
        room["openings"] = await openings_repo.list_for_room(conn, room_id)
    return room
