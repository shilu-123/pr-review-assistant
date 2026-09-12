import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Most free hosted Postgres providers (Neon, Supabase, etc.) require SSL.
# Set DB_SSL=false in .env if you're pointing this at a local Postgres
# instance that doesn't have SSL configured.
DB_SSL = os.getenv("DB_SSL", "true").lower() == "true"
_connect_args = {"ssl": "require"} if DB_SSL else {}

Base = declarative_base()

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=_connect_args) if DATABASE_URL else None
AsyncSessionLocal = (
    async_sessionmaker(engine, expire_on_commit=False) if engine is not None else None
)


async def init_db() -> None:
    """Create tables on startup if they don't exist yet. No-op if DATABASE_URL isn't set."""
    if engine is None:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to backend/.env — see README for setup."
        )
    async with AsyncSessionLocal() as session:
        yield session
