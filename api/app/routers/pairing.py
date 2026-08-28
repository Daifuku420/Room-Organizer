"""Device onboarding without user accounts.

  1. Desktop, first run: POST /pairing/bootstrap with BOOTSTRAP_SECRET.
     Creates the workspace and returns the desktop's token.
  2. Desktop: POST /pairing/code -> a 6-digit code, valid 10 minutes.
  3. Phone:   POST /pairing/claim with that code -> the phone's own token.

The secret is only ever used once. Everything after that is bearer tokens.
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ..config import settings
from ..db import connection
from ..schemas import BootstrapRequest, ClaimRequest, PairingCodeResponse, TokenResponse
from ..security import Caller, current_device, new_pairing_code, new_token

router = APIRouter(prefix="/pairing", tags=["pairing"])


@router.post("/bootstrap", response_model=TokenResponse)
async def bootstrap(body: BootstrapRequest) -> TokenResponse:
    # compare_digest, not ==, so response time does not leak the secret.
    if not secrets.compare_digest(body.secret, settings.bootstrap_secret):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "bad secret")

    token, digest = new_token()
    async with connection() as conn:
        async with conn.transaction():
            workspace_id = await conn.fetchval(
                "INSERT INTO workspace (name) VALUES ($1) RETURNING id::text",
                body.workspace_name,
            )
            device_id = await conn.fetchval(
                """
                INSERT INTO device (workspace_id, kind, name, token_sha256)
                     VALUES ($1, 'desktop', $2, $3)
                  RETURNING id::text
                """,
                workspace_id, body.device_name, digest,
            )

    return TokenResponse(token=token, device_id=device_id, workspace_id=workspace_id)


@router.post("/code", response_model=PairingCodeResponse)
async def create_code(caller: Caller = Depends(current_device)) -> PairingCodeResponse:
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=settings.pairing_code_ttl_seconds
    )

    async with connection() as conn:
        for _ in range(5):  # retry on the rare collision with a live code
            code = new_pairing_code()
            inserted = await conn.fetchval(
                """
                INSERT INTO pairing_code (code, workspace_id, expires_at)
                     VALUES ($1, $2, $3)
                ON CONFLICT (code) DO NOTHING
                  RETURNING code
                """,
                code, caller.workspace_id, expires_at,
            )
            if inserted:
                return PairingCodeResponse(code=inserted, expires_at=expires_at)

    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "could not allocate a code")


@router.post("/claim", response_model=TokenResponse)
async def claim(body: ClaimRequest) -> TokenResponse:
    token, digest = new_token()

    async with connection() as conn:
        async with conn.transaction():
            # Claiming and marking used happen in one statement, so the same
            # code cannot be redeemed twice by two racing phones.
            workspace_id = await conn.fetchval(
                """
                UPDATE pairing_code
                   SET claimed_at = now()
                 WHERE code = $1 AND claimed_at IS NULL AND expires_at > now()
             RETURNING workspace_id::text
                """,
                body.code,
            )
            if workspace_id is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "invalid or expired code")

            device_id = await conn.fetchval(
                """
                INSERT INTO device (workspace_id, kind, name, token_sha256)
                     VALUES ($1, 'phone', $2, $3)
                  RETURNING id::text
                """,
                workspace_id, body.device_name, digest,
            )

    return TokenResponse(token=token, device_id=device_id, workspace_id=workspace_id)
