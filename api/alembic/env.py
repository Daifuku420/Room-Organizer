"""Alembic environment.

The app talks to Postgres through asyncpg, so migrations do too: one driver,
one set of connection semantics, no second dependency to keep in step.

There are no SQLAlchemy models in this project — the schema is hand-written
SQL — so target_metadata is None and `alembic revision --autogenerate` will not
work. Write migrations by hand with `alembic revision -m "what you changed"`.
"""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _database_url() -> str:
    url = os.environ["DATABASE_URL"]
    # asyncpg is addressed as postgresql+asyncpg:// by SQLAlchemy, while the
    # app uses the bare postgresql:// form asyncpg expects directly.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


config.set_main_option("sqlalchemy.url", _database_url())


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it — useful for review."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
