from fastapi import APIRouter, Depends, Query

from ..db import connection
from ..repositories import catalog as repo
from ..schemas import CatalogItem
from ..security import Caller, current_device

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/items", response_model=list[CatalogItem])
async def search_items(
    q: str | None = Query(default=None, min_length=1, max_length=120),
    category: str | None = Query(default=None, min_length=1, max_length=60),
    caller: Caller = Depends(current_device),
):
    async with connection() as conn:
        return await repo.search(conn, q, category)


@router.get("/categories", response_model=list[str])
async def list_categories(caller: Caller = Depends(current_device)):
    async with connection() as conn:
        return await repo.list_categories(conn)
