from fastapi import APIRouter, Depends, HTTPException, status

from ..db import connection
from ..repositories import openings as repo
from ..schemas import Opening, OpeningCreate, OpeningPatch
from ..security import Caller, current_device

router = APIRouter(tags=["openings"])


@router.post(
    "/walls/{wall_id}/openings",
    response_model=Opening,
    status_code=status.HTTP_201_CREATED,
)
async def create_opening(
    wall_id: str, body: OpeningCreate, caller: Caller = Depends(current_device)
):
    if body.kind == "door" and body.swing == "none":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "a door needs a swing direction"
        )

    async with connection() as conn:
        opening = await repo.create(conn, caller.workspace_id, wall_id, body)
    if opening is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such wall")
    return opening


@router.patch("/openings/{opening_id}", response_model=Opening)
async def patch_opening(
    opening_id: str, body: OpeningPatch, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        opening = await repo.patch(conn, caller.workspace_id, opening_id, body)
    if opening is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such opening")
    return opening


@router.delete("/openings/{opening_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_opening(opening_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        if not await repo.delete(conn, caller.workspace_id, opening_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such opening")
