FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY core/requirements.txt /app/core/requirements.txt
RUN pip install --no-cache-dir -r /app/core/requirements.txt

COPY core /app/core
COPY datahub-setup /app/datahub-setup

ENV PYTHONPATH=/app/core \
    RESIDENCE_ENV=production \
    CORE_HOST=0.0.0.0 \
    CORE_PORT=8700 \
    RESIDENCE_REQUIRE_AUTH=1 \
    RESIDENCE_ALLOW_RESET=0 \
    RESIDENCE_PERSIST_DIR=/var/lib/residence

RUN mkdir -p /var/lib/residence

EXPOSE 8700

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8700/health || exit 1

WORKDIR /app/core
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8700"]
