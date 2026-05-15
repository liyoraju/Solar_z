FROM node:22-alpine AS frontend-builder
WORKDIR /build
COPY solar-monitor/package.json solar-monitor/package-lock.json ./
RUN npm ci
COPY solar-monitor/ .
RUN npm run build -- --outDir dist

FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/requirements.txt .
RUN uv pip install --system -r requirements.txt
COPY api/ .
COPY --from=frontend-builder /build/dist ./static

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "info"]