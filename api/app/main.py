from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import close_pool, connection, open_pool
from .routers import pairing, rooms


@asynccontextmanager
async def lifespan(_: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Room planner API", version="0.1.0", lifespan=lifespan)

app.include_router(pairing.router)
app.include_router(rooms.router)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    async with connection() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ok"}
