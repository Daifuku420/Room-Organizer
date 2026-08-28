"""Connection pool lifecycle. Everything else takes a connection as an argument,
so repositories stay testable without a running FastAPI app."""

from contextlib import asynccontextmanager

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def open_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=8)


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("pool not initialised")
    return _pool


@asynccontextmanager
async def connection():
    async with pool().acquire() as conn:
        yield conn
