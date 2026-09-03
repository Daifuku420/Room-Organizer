from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import close_pool, connection, open_pool
from .routers import catalog, layouts, openings, pairing, rooms, wall_features


@asynccontextmanager
async def lifespan(_: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Room planner API", version="0.3.0", lifespan=lifespan)

app.include_router(pairing.router)
app.include_router(rooms.router)
app.include_router(layouts.router)
app.include_router(openings.router)
app.include_router(wall_features.router)
app.include_router(catalog.router)

# No CORS middleware on purpose. The desktop client makes its HTTP calls from
# Rust via the Tauri http plugin, not from the webview, so no browser origin is
# involved. Adding CORS here would only widen the surface.


@app.get("/health", tags=["meta"])
async def health() -> dict:
    async with connection() as conn:
        await conn.execute("SELECT 1")
    return {"status": "ok"}
