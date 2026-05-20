# Solar_z — Solar Energy Intelligence Platform

Full-stack solar monitoring system for Deye on grid inverters. Collects telemetry from the Deye Cloud API, stores it in PostgreSQL (Neon-compatible), and serves a real-time dashboard.

## Architecture

```
Deye Cloud API  ──HTTPS──>  Collector  ──>  Postgres SQL
                                   \──>  Redis ──>  FastAPI  <──  React SPA
```

| Component | Role | Tech |
|-----------|------|------|
| **collector/** | Polls Deye API every 10s, normalises payload, stores to DB, publishes to Redis | Python, aiohttp, asyncpg |
| **api/** | REST endpoints, WebSocket streaming, embedded collector, static file server | FastAPI, Uvicorn |
| **solar-monitor/** | Real-time dashboard with charts, offline support, push notifications | React 19, TypeScript, Tailwind v4, Recharts |
| **init/** | PostgreSQL schema (tables, indexes, views) | SQL |

## Quick Start

```bash
# 1. Configure environment
cp .env.example .env   # edit with your Deye credentials

# 2. Launch all services
docker compose up -d

# 3. Open the app
open http://localhost:8000
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `api` | 8000 | FastAPI backend + SPA |
| `postgres` | 5432 | PostgreSQL (Neon-compatible) |
| `redis` | 6379 | Cache & pub/sub |
| `collector` | (internal) | Telemetry collector |

## Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEYE_APP_ID` | — | Deye Cloud API app ID |
| `DEYE_APP_SECRET` | — | Deye Cloud API secret |
| `DEYE_EMAIL` | — | Deye account email |
| `DEYE_PASSWORD` | — | Deye account password |
| `COLLECTOR_INTERVAL` | `10` | Polling interval (seconds) |
| `FEED_IN_TARIFF` | `3.50` | Export tariff (₹/kWh) |
| `TARIFF_MODE` | `telescopic` | Tariff calculation mode |
| `ALERT_TEMP_HIGH` | `75` | Temperature alert threshold (°C) |

## Development

```bash
# Backend
uv venv && source .venv/bin/activate
uv pip install -r api/requirements.txt -r collector/requirements.txt
cd api && uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd solar-monitor && npm install && npm run dev
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/overview` | Live overview (PV, grid, load, battery) |
| `GET /api/analytics/financial` | Financial summary + CO₂ offset |
| `GET /api/telemetry/history` | Aggregated history by time bucket |
| `GET /api/telemetry/daily` | Daily summaries |
| `GET /api/analytics/billing-cycles` | Billing cycle list |
| `WS /api/ws/telemetry` | Real-time telemetry stream |
| `WS /api/ws/alerts` | Real-time alert stream |

## Tech Stack

**Backend:** Python 3.11, FastAPI, asyncpg, aiohttp, Redis, Pydantic  
**Database:** PostgreSQL   
**Frontend:** React 19, TypeScript, Tailwind CSS 4, Recharts, Lucide  
**Mobile:** Capacitor 8 (Android push notifications)  
**Infra:** Docker Compose
