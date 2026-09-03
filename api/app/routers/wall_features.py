from fastapi import APIRouter, Depends, HTTPException, status

from ..db import connection
from ..repositories import wall_features as repo
from ..schemas import WallFeature, WallFeatureCreate, WallFeaturePatch
from ..security import Caller, current_device

router = APIRouter(tags=["wall-features"])


@router.post(
    "/walls/{wall_id}/features",
    response_model=WallFeature,
    status_code=status.HTTP_201_CREATED,
)
async def create_feature(
    wall_id: str, body: WallFeatureCreate, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        feature = await repo.create(conn, caller.workspace_id, wall_id, body)
    if feature is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such wall")
    return feature


@router.patch("/features/{feature_id}", response_model=WallFeature)
async def patch_feature(
    feature_id: str, body: WallFeaturePatch, caller: Caller = Depends(current_device)
):
    async with connection() as conn:
        feature = await repo.patch(conn, caller.workspace_id, feature_id, body)
    if feature is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such feature")
    return feature


@router.delete("/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(feature_id: str, caller: Caller = Depends(current_device)):
    async with connection() as conn:
        if not await repo.delete(conn, caller.workspace_id, feature_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such feature")
