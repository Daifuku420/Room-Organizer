"""Device tokens.

A token is 32 random bytes, base64url-encoded, shown to the client exactly once.
Only its SHA-256 is stored, so a database leak does not hand over API access.
"""

import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from .db import connection


def new_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).digest()


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_pairing_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@dataclass(frozen=True)
class Caller:
    device_id: str
    workspace_id: str
    kind: str


async def current_device(authorization: str = Header(default="")) -> Caller:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")

    async with connection() as conn:
        row = await conn.fetchrow(
            """
            UPDATE device SET last_seen_at = now()
             WHERE token_sha256 = $1
         RETURNING id::text, workspace_id::text, kind::text
            """,
            hash_token(token),
        )

    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown token")

    return Caller(row["id"], row["workspace_id"], row["kind"])


CallerDep = Depends(current_device)
