FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini entrypoint.sh ./
COPY alembic ./alembic
COPY app ./app

RUN useradd --system --uid 1001 appuser \
 && mkdir -p /media && chown appuser /media \
 && chmod +x entrypoint.sh
USER appuser

EXPOSE 8000
CMD ["./entrypoint.sh"]
