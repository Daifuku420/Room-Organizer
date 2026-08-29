#!/bin/sh
# Migrate, then serve. Running migrations at container start means a deploy is
# always "pull, build, up" with nothing to remember; if a migration fails the
# container exits rather than serving against a schema it does not expect.
set -e

alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
