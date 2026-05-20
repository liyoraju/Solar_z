"""
Solar Energy Intelligence Platform — API Service
=================================================
FastAPI application providing REST endpoints, WebSocket realtime feeds,
alert management, configuration UI, and analytics for the Deye SUN-3K-G03.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import struct
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import aiohttp
import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def get_cycle_start(today: datetime, start_day: int) -> datetime:
    if today.day >= start_day:
        return today.replace(day=start_day, hour=0, minute=0, second=0, microsecond=0)
    prev = today.replace(day=1) - timedelta(days=1)
    return prev.replace(day=start_day, hour=0, minute=0, second=0, microsecond=0)


_INTERVAL_MAP = {
    "5 seconds": "to_timestamp(floor(extract(epoch from time) / 5) * 5)",
    "1 minute": "date_trunc('minute', time)",
    "5 minutes": "to_timestamp(floor(extract(epoch from time) / 300) * 300)",
    "1 hour": "date_trunc('hour', time)",
    "1 day": "date_trunc('day', time)",
}


def _time_bucket_sql(interval: str) -> tuple[str, str]:
    expr = _INTERVAL_MAP.get(interval, "date_trunc('hour', time)")
    return f"{expr}::text", expr


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
log = logging.getLogger("api")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class Settings(BaseModel):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://solar:solar_secure_2024@postgres:5432/solar_platform",
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://:redis_secure_2024@redis:6379/0")
    deye_api_base: str = os.getenv("DEYE_API_BASE_URL", "https://api.deyecloud.com")
    deye_app_id: str = os.getenv("DEYE_APP_ID", "")
    deye_app_secret: str = os.getenv("DEYE_APP_SECRET", "")
    secret_key: str = os.getenv("API_SECRET_KEY", "change_me")
    feed_in_tariff: float = float(os.getenv("FEED_IN_TARIFF", "3.50"))
    grid_import_tariff: float = float(os.getenv("GRID_IMPORT_TARIFF", "6.00"))
    currency: str = os.getenv("CURRENCY", "INR")
    firebase_credentials_path: str = os.getenv("FIREBASE_CREDENTIALS_PATH", "")


settings = Settings()

# ---------------------------------------------------------------------------
# Globals (set during lifespan)
# ---------------------------------------------------------------------------
db_pool: Optional[asyncpg.Pool] = None
redis: Optional[aioredis.Redis] = None


async def _load_cycle_tariff() -> dict:
    feed_in = float((await redis.get("cfg:feed_in_tariff")) or settings.feed_in_tariff)
    active_rate = float(await redis.get("collector:tariff_rate") or "0")
    return {"feed_in_tariff": feed_in, "active_rate": active_rate}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class TelemetrySnapshot(BaseModel):
    time: str
    inverter_sn: str
    pv1_power: Optional[float] = None
    pv2_power: Optional[float] = None
    grid_export_power: Optional[float] = None
    grid_import_power: Optional[float] = None
    load_power: Optional[float] = None
    battery_soc: Optional[float] = None
    battery_power: Optional[float] = None
    inverter_temperature: Optional[float] = None
    inverter_power: Optional[float] = None
    grid_frequency: Optional[float] = None
    grid_voltage_r: Optional[float] = None
    daily_production: Optional[float] = None
    total_production: Optional[float] = None
    daily_savings: Optional[float] = None
    total_savings: Optional[float] = None
    fault_code: Optional[int] = None
    warning_code: Optional[int] = None
    working_mode: Optional[int] = None
    inverter_status: Optional[int] = None


class HistoryPoint(BaseModel):
    time: str
    avg_pv_power: Optional[float] = None
    peak_pv_power: Optional[float] = None
    avg_inverter_power: Optional[float] = None
    peak_inverter_power: Optional[float] = None
    max_temperature: Optional[float] = None
    avg_frequency: Optional[float] = None
    daily_production_kwh: Optional[float] = None
    daily_savings: Optional[float] = None
    sample_count: Optional[int] = None


class AlertItem(BaseModel):
    id: int
    created_at: str
    inverter_sn: str
    alert_type: str
    severity: str
    message: str
    value: Optional[float] = None
    threshold: Optional[float] = None
    acknowledged: bool


class Overview(BaseModel):
    inverter_sn: Optional[str] = None
    status: str = "unknown"
    pv_power: float = 0
    grid_power: float = 0
    load_power: float = 0
    battery_soc: Optional[float] = None
    temperature: Optional[float] = None
    daily_production: float = 0
    total_production: float = 0
    daily_savings: float = 0
    total_savings: float = 0
    daily_gap_kwh: float = 0
    total_gap_kwh: float = 0
    fault_active: bool = False
    uptime_samples: int = 0
    inverter_status: Optional[int] = None
    working_mode: Optional[int] = None


class ConfigUpdate(BaseModel):
    key: str
    value: str


class DeyeCredentials(BaseModel):
    email: str = ""
    password: str = ""
    inverter_sn: Optional[str] = None


class ConnTestResult(BaseModel):
    success: bool
    message: str
    inverters: Optional[List[Dict[str, Any]]] = None


class CollectorStatus(BaseModel):
    status: str
    collection_count: int = 0
    error_count: int = 0
    last_collection: Optional[str] = None
    buffer_size: int = 0
    inverter_sn: Optional[str] = None
    billing_kwh: float = 0
    tariff_rate: float = 0


class HealthResult(BaseModel):
    status: str = "ok"
    postgres: bool = False
    redis: bool = False
    uptime: float = 0


class TariffSlab(BaseModel):
    upper_kwh: int
    rate: float


class TariffConfig(BaseModel):
    mode: str = "telescopic"
    slabs: List[TariffSlab] = []
    non_telescopic_slabs: List[TariffSlab] = []
    billing_days: int = 60
    feed_in_tariff: float = 3.50
    grid_import_tariff: float = 6.00
    currency: str = "INR"
    billing_kwh: float = 0
    cycle_start: Optional[str] = None
    cycle_end_date: Optional[str] = None
    active_rate: float = 0


class AckResponse(BaseModel):
    success: bool


class RegisterRequest(BaseModel):
    email: str
    password: str
    inverter_sn: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: Dict[str, Any]


# ---------------------------------------------------------------------------
# Simple JWT-like token (HMAC-based, no external deps)
# ---------------------------------------------------------------------------
def _make_token(user_id: int, email: str, secret: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b'=').decode()
    now = int(time.time())
    payload = base64.urlsafe_b64encode(json.dumps({"sub": str(user_id), "email": email, "iat": now, "exp": now + 86400 * 30}).encode()).rstrip(b'=').decode()
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return f"{header}.{payload}.{signature}"


def _verify_token(token: str, secret: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, payload, signature = parts
        expected_sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        payload_bytes = base64.urlsafe_b64decode(payload + '==')
        data = json.loads(payload_bytes)
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}${h}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split('$', 1)
        return hashlib.sha256(f"{salt}{password}".encode()).hexdigest() == h
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# WebSocket manager
# ---------------------------------------------------------------------------
class WSManager:
    def __init__(self):
        self.telemetry_clients: List[WebSocket] = []
        self.alert_clients: List[WebSocket] = []

    async def connect_telemetry(self, ws: WebSocket):
        await ws.accept()
        self.telemetry_clients.append(ws)

    async def connect_alert(self, ws: WebSocket):
        await ws.accept()
        self.alert_clients.append(ws)

    def disconnect_telemetry(self, ws: WebSocket):
        if ws in self.telemetry_clients:
            self.telemetry_clients.remove(ws)

    def disconnect_alert(self, ws: WebSocket):
        if ws in self.alert_clients:
            self.alert_clients.remove(ws)

    async def broadcast_telemetry(self, data: Dict):
        dead = []
        for ws in self.telemetry_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_telemetry(ws)

    async def broadcast_alert(self, data: Dict):
        dead = []
        for ws in self.alert_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_alert(ws)


ws_mgr = WSManager()


# ---------------------------------------------------------------------------
# Redis pub-sub bridge (background task)
# ---------------------------------------------------------------------------
async def redis_bridge():
    """Subscribe to Redis channels and forward to WebSocket clients."""
    while True:
        try:
            sub = redis.pubsub()
            await sub.psubscribe("telemetry:realtime:*")
            await sub.subscribe("solar:alerts")
            log.info("Redis pub-sub bridge connected")
            async for msg in sub.listen():
                if msg["type"] not in ("pmessage", "message"):
                    continue
                try:
                    data = json.loads(msg["data"])
                    channel = msg.get("channel", "")
                    if channel.startswith("telemetry:realtime:"):
                        await ws_mgr.broadcast_telemetry(data)
                    elif channel == "solar:alerts":
                        await ws_mgr.broadcast_alert(data)
                        asyncio.create_task(
                            send_push_to_all(
                                title=f"Solar Alert: {data.get('severity', 'info')}",
                                body=data.get("message", ""),
                                data={"type": data.get("type", ""), "inverter_sn": data.get("inverter_sn", "")},
                            )
                        )
                except Exception:
                    pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.warning("Redis pub-sub bridge error: %s — reconnecting in 5s", e)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# FakeRedis — in-memory fallback when no Redis available
# ---------------------------------------------------------------------------
class FakeRedis:
    _store: dict = {}
    async def get(self, key): return self._store.get(key)
    async def set(self, key, value): self._store[key] = value
    async def delete(self, key): self._store.pop(key, None)
    async def ping(self): return True
    async def close(self): pass
    def pubsub(self): return self
    async def psubscribe(self, *a, **kw): pass
    async def subscribe(self, *a, **kw): pass
    async def unsubscribe(self, *a, **kw): pass
    def listen(self): return self
    def __aiter__(self): return self
    async def __anext__(self):
        await asyncio.sleep(3600)
        return {"type": "message", "data": "{}", "channel": ""}


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
_start_time = datetime.now(timezone.utc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis
    db_pool = await asyncpg.create_pool(settings.database_url, min_size=3, max_size=15)
    try:
        if settings.redis_url:
            redis = aioredis.from_url(
                settings.redis_url, decode_responses=True, max_connections=10
            )
            await redis.ping()
            log.info("Connected to PostgreSQL and Redis")
        else:
            redis = FakeRedis()
            log.info("No Redis URL set — using in-memory fallback")
    except Exception as e:
        redis = FakeRedis()
        log.warning("Redis connection failed (%s) — using in-memory fallback", e)

    bridge_task = asyncio.create_task(redis_bridge()) if not isinstance(redis, FakeRedis) else None

    collector_task: Optional[asyncio.Task] = None
    if os.getenv("COLLECTOR_ENABLED", "1") == "1":
        try:
            import sys
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
            from collector.main import Collector

            c = Collector(pool=db_pool, rd=redis if not isinstance(redis, FakeRedis) else None)
            await c.start()
            async def _run_collector():
                try:
                    await c.run()
                finally:
                    await c.stop()
            collector_task = asyncio.create_task(_run_collector())
            log.info("Collector running in background")
        except Exception as e:
            log.warning("Collector failed to start (%s) — API continues without it", e)

    yield
    if bridge_task:
        bridge_task.cancel()
    if collector_task:
        collector_task.cancel()
        try:
            await asyncio.wait_for(collector_task, timeout=15)
        except asyncio.TimeoutError:
            pass
    if db_pool:
        await db_pool.close()
    if redis and not isinstance(redis, FakeRedis):
        await redis.close()
    log.info("Shutdown complete")


app = FastAPI(title="Solar Intelligence Platform", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in ("/api/health", "/api/auth/register", "/api/auth/login") or \
       not path.startswith("/api/") or \
       path.startswith("/api/ws/") or \
       request.method == "OPTIONS":
        return await call_next(request)
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    token = auth_header[7:]
    payload = _verify_token(token, settings.secret_key)
    if not payload:
        return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
    request.state.user = payload
    return await call_next(request)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/api/health", response_model=HealthResult)
async def health():
    pg_ok = False
    rd_ok = False
    try:
        if db_pool:
            async with db_pool.acquire() as c:
                await c.fetchval("SELECT 1")
            pg_ok = True
    except Exception:
        pass
    try:
        if redis:
            await redis.ping()
            rd_ok = True
    except Exception:
        pass
    return HealthResult(
        status="ok" if (pg_ok and rd_ok) else "degraded",
        postgres=pg_ok,
        redis=rd_ok,
        uptime=(datetime.now(timezone.utc) - _start_time).total_seconds(),
    )


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
@app.post("/api/auth/register", response_model=AuthResponse)
async def auth_register(body: RegisterRequest):
    if not body.email or not body.password:
        raise HTTPException(400, "Email and password are required")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    try:
        async with db_pool.acquire() as c:
            existing = await c.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
            if existing:
                raise HTTPException(400, "Email already registered")
            pw_hash = _hash_password(body.password)
            row = await c.fetchrow(
                "INSERT INTO users (email, password_hash, inverter_sn) VALUES ($1, $2, $3) RETURNING id, email, inverter_sn",
                body.email, pw_hash, body.inverter_sn,
            )
            token = _make_token(row["id"], row["email"], settings.secret_key)
            return AuthResponse(
                token=token,
                user={"id": row["id"], "email": row["email"], "inverter_sn": row["inverter_sn"]},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/auth/login", response_model=AuthResponse)
async def auth_login(body: LoginRequest):
    if not body.email or not body.password:
        raise HTTPException(400, "Email and password are required")
    try:
        async with db_pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT id, email, password_hash, inverter_sn FROM users WHERE email = $1",
                body.email,
            )
            if not row or not _verify_password(body.password, row["password_hash"]):
                raise HTTPException(401, "Invalid email or password")
            token = _make_token(row["id"], row["email"], settings.secret_key)
            return AuthResponse(
                token=token,
                user={"id": row["id"], "email": row["email"], "inverter_sn": row["inverter_sn"]},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


async def get_current_user(request: Request) -> Dict[str, Any]:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = auth_header[7:]
    payload = _verify_token(token, settings.secret_key)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    try:
        async with db_pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT id, email, inverter_sn FROM users WHERE id = $1",
                int(payload["sub"]),
            )
            if not row:
                raise HTTPException(401, "User not found")
            return {"id": row["id"], "email": row["email"], "inverter_sn": row["inverter_sn"]}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Authentication failed")


# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------
@app.get("/api/telemetry/realtime")
async def telemetry_realtime(sn: Optional[str] = None):
    """Latest telemetry from Redis cache, falling back to DB."""
    if not sn:
        try:
            if db_pool:
                async with db_pool.acquire() as c:
                    row = await c.fetchrow(
                        "SELECT serial_number FROM inverters LIMIT 1"
                    )
                    if row:
                        sn = row["serial_number"]
        except Exception:
            pass
    if sn:
        try:
            cached = await redis.get(f"telemetry:latest:{sn}")
            if cached:
                return JSONResponse(content=json.loads(cached))
        except Exception:
            pass
    # Fallback: last row from DB
    try:
        async with db_pool.acquire() as c:
            q = "SELECT * FROM telemetry"
            params: list = []
            if sn:
                q += " WHERE inverter_sn = $1"
                params.append(sn)
            q += " ORDER BY time DESC LIMIT 1"
            row = await c.fetchrow(q, *params)
            if row:
                return JSONResponse(content=dict(row))
    except Exception as e:
        raise HTTPException(500, str(e))
    raise HTTPException(404, "No telemetry data available")


@app.get("/api/telemetry/history", response_model=List[HistoryPoint])
async def telemetry_history(
    sn: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    interval: str = Query("1 hour", pattern=r"^\d+\s+(second|minute|hour|day)$"),
    limit: int = Query(500, le=5000),
):
    """Aggregated history with configurable time bucket."""
    try:
        async with db_pool.acquire() as c:
            where = []
            params: list = []
            idx = 1
            if sn:
                where.append(f"inverter_sn = ${idx}")
                params.append(sn)
                idx += 1
            if start:
                where.append(f"time >= ${idx}")
                params.append(start)
                idx += 1
            if end:
                where.append(f"time <= ${idx}")
                params.append(end)
                idx += 1
            w = ("WHERE " + " AND ".join(where)) if where else ""
            bucket_expr, bucket_group = _time_bucket_sql(interval)
            rows = await c.fetch(
                f"""
                SELECT
                    {bucket_expr} AS time,
                    AVG(COALESCE(pv1_power,0) + COALESCE(pv2_power,0)) AS avg_pv_power,
                    MAX(COALESCE(pv1_power,0) + COALESCE(pv2_power,0)) AS peak_pv_power,
                    AVG(inverter_power) AS avg_inverter_power,
                    MAX(inverter_power) AS peak_inverter_power,
                    MAX(inverter_temperature) AS max_temperature,
                    AVG(grid_frequency) AS avg_frequency,
                    MAX(daily_production) AS daily_production_kwh,
                    MAX(daily_savings) AS daily_savings,
                    COUNT(*) AS sample_count
                FROM telemetry {w}
                GROUP BY {bucket_group}
                ORDER BY 1 DESC LIMIT {limit}
            """,
                *params,
            )
            return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/telemetry/daily", response_model=List[HistoryPoint])
async def telemetry_daily(sn: Optional[str] = None, days: int = Query(30, le=365)):
    try:
        async with db_pool.acquire() as c:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            sn_filter = " AND inverter_sn = $2" if sn else ""
            params: list = [cutoff]
            if sn:
                params.append(sn)
            q = """SELECT day::text AS time,
                          COALESCE(avg_pv1_power,0) + COALESCE(avg_pv2_power,0) AS avg_pv_power,
                          COALESCE(peak_pv1_power,0) + COALESCE(peak_pv2_power,0) AS peak_pv_power,
                          avg_inverter_power, peak_inverter_power,
                          max_temperature, avg_frequency,
                          daily_production_kwh, daily_savings, sample_count
                   FROM telemetry_daily WHERE day >= $1""" + sn_filter + """
                   ORDER BY day DESC"""
            rows = await c.fetch(q, *params)
            return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/telemetry/monthly", response_model=List[HistoryPoint])
async def telemetry_monthly(sn: Optional[str] = None, months: int = Query(12, le=60)):
    try:
        async with db_pool.acquire() as c:
            q = """SELECT month::text AS time, avg_inverter_power, peak_inverter_power,
                          max_temperature, avg_frequency,
                          total_grid_export_kwh, total_grid_import_kwh, total_load_kwh,
                          total_production_kwh, total_savings, sample_count
                   FROM telemetry_monthly WHERE month >= NOW() - ($1 || ' months')::INTERVAL """
            params: list = [str(months)]
            if sn:
                q += " AND inverter_sn = $2"
                params.append(sn)
            q += " ORDER BY month DESC"
            rows = await c.fetch(q, *params)
            return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(500, str(e))


class MonthlyStats(BaseModel):
    month: str
    monthly_production_kwh: float = 0
    monthly_savings: float = 0
    total_grid_export_kwh: float = 0
    total_grid_import_kwh: float = 0
    total_load_kwh: float = 0
    avg_inverter_power: Optional[float] = None
    peak_inverter_power: Optional[float] = None
    max_temperature: Optional[float] = None
    sample_count: Optional[int] = None
    self_consumption_pct: float = 0


@app.get("/api/analytics/monthly", response_model=List[MonthlyStats])
async def analytics_monthly(months: int = Query(12, le=60)):
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                """SELECT month::text,
                          monthly_production_kwh,
                          monthly_savings,
                          total_grid_export_kwh,
                          total_grid_import_kwh,
                          total_load_kwh,
                          avg_inverter_power,
                          peak_inverter_power,
                          max_temperature,
                          sample_count
                   FROM telemetry_monthly_deltas
                   WHERE month >= NOW() - ($1 || ' months')::INTERVAL
                   ORDER BY month DESC""",
                str(months),
            )
            result = []
            for r in rows:
                prod = r["monthly_production_kwh"] or 0
                export = r["total_grid_export_kwh"] or 0
                self_consumption = round((prod - export) / prod * 100, 1) if prod > 0 else 0
                result.append(MonthlyStats(
                    month=r["month"],
                    monthly_production_kwh=round(prod, 2),
                    monthly_savings=round(r["monthly_savings"] or 0, 2),
                    total_grid_export_kwh=round(export, 2),
                    total_grid_import_kwh=round(r["total_grid_import_kwh"] or 0, 2),
                    total_load_kwh=round(r["total_load_kwh"] or 0, 2),
                    avg_inverter_power=r["avg_inverter_power"],
                    peak_inverter_power=r["peak_inverter_power"],
                    max_temperature=r["max_temperature"],
                    sample_count=r["sample_count"],
                    self_consumption_pct=self_consumption,
                ))
            return result
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Analytics / Overview
# ---------------------------------------------------------------------------
@app.get("/api/analytics/overview", response_model=Overview)
async def analytics_overview():
    try:
        async with db_pool.acquire() as c:
            inv = await c.fetchrow(
                "SELECT serial_number, status FROM inverters LIMIT 1"
            )
            latest = await c.fetchrow(
                "SELECT * FROM telemetry ORDER BY time DESC LIMIT 1"
            )
            if not latest:
                return Overview(
                    inverter_sn=inv["serial_number"] if inv else None,
                    status=inv["status"] if inv else "no_data",
                )
            today_gap = await c.fetchval(
                """SELECT COALESCE(SUM(kwh_missed), 0)
                   FROM telemetry_gap_alerts
                   WHERE gap_start >= CURRENT_DATE AND status = 'active'"""
            ) or 0
            total_gap = await c.fetchval(
                """SELECT COALESCE(SUM(kwh_missed), 0)
                   FROM telemetry_gap_alerts
                   WHERE status = 'active'"""
            ) or 0
            pv = (latest["pv1_power"] or 0) + (latest["pv2_power"] or 0)
            gexp = latest["grid_export_power"] or 0
            gimp = latest["grid_import_power"] or 0
            return Overview(
                inverter_sn=latest["inverter_sn"],
                status=inv["status"] if inv else "online",
                pv_power=round(pv, 1),
                grid_power=round(gexp - gimp, 1),
                load_power=round(latest["load_power"] or 0, 1),
                battery_soc=latest["battery_soc"],
                temperature=latest["inverter_temperature"],
                daily_production=round(latest["daily_production"] or 0, 2),
                total_production=round(latest["total_production"] or 0, 2),
                daily_savings=round(latest["daily_savings"] or 0, 4),
                total_savings=round(latest["total_savings"] or 0, 2),
                daily_gap_kwh=round(float(today_gap), 2),
                total_gap_kwh=round(float(total_gap), 2),
                fault_active=bool(
                    latest["fault_code"] and int(latest["fault_code"]) != 0
                ),
                inverter_status=latest.get("inverter_status"),
                working_mode=latest.get("working_mode"),
            )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/financial")
async def analytics_financial():
    try:
        async with db_pool.acquire() as c:
            row = await c.fetchrow("""
                SELECT
                    total_production AS total_kwh,
                    total_grid_export AS total_export_kwh,
                    total_grid_import AS total_import_kwh,
                    total_savings AS total_savings,
                    daily_production AS today_kwh,
                    daily_savings AS today_savings
                FROM telemetry ORDER BY time DESC LIMIT 1
            """)
            if not row:
                return {}
            today_gap = await c.fetchval(
                """SELECT COALESCE(SUM(kwh_missed), 0)
                   FROM telemetry_gap_alerts
                   WHERE gap_start >= CURRENT_DATE AND status = 'active'"""
            ) or 0
            tariff_feed = float(
                (await redis.get("cfg:feed_in_tariff")) or settings.feed_in_tariff
            )
            tariff_import = float(
                (await redis.get("cfg:grid_import_tariff"))
                or settings.grid_import_tariff
            )
            currency = (await redis.get("cfg:currency")) or settings.currency
            return {
                "total_production_kwh": round(row["total_kwh"] or 0, 2),
                "total_export_kwh": round(row["total_export_kwh"] or 0, 2),
                "total_import_kwh": round(row["total_import_kwh"] or 0, 2),
                "total_savings": round(row["total_savings"] or 0, 2),
                "today_production_kwh": round(row["today_kwh"] or 0, 2),
                "today_savings": round(row["today_savings"] or 0, 4),
                "today_gap_kwh": round(float(today_gap), 2),
                "feed_in_tariff": tariff_feed,
                "grid_import_tariff": tariff_import,
                "currency": currency,
                "co2_avoided_tonnes": round((row["total_kwh"] or 0) / 1000 * 0.42, 2),
            }
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
@app.get("/api/alerts", response_model=List[AlertItem])
async def list_alerts(
    severity: Optional[str] = None,
    acknowledged: Optional[bool] = None,
    limit: int = Query(50, le=500),
):
    try:
        async with db_pool.acquire() as c:
            where, params, idx = [], [], 1
            if severity:
                where.append(f"severity = ${idx}")
                params.append(severity)
                idx += 1
            if acknowledged is not None:
                where.append(f"acknowledged = ${idx}")
                params.append(acknowledged)
                idx += 1
            w = ("WHERE " + " AND ".join(where)) if where else ""
            rows = await c.fetch(
                f"SELECT * FROM alerts {w} ORDER BY created_at DESC LIMIT {limit}",
                *params,
            )
            return [
                AlertItem(
                    id=r["id"],
                    created_at=r["created_at"].isoformat(),
                    inverter_sn=r["inverter_sn"],
                    alert_type=r["alert_type"],
                    severity=r["severity"],
                    message=r["message"],
                    value=r["value"],
                    threshold=r["threshold"],
                    acknowledged=r["acknowledged"],
                )
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/alerts/{alert_id}/acknowledge", response_model=AckResponse)
async def ack_alert(alert_id: int):
    try:
        async with db_pool.acquire() as c:
            r = await c.execute(
                "UPDATE alerts SET acknowledged = TRUE WHERE id = $1", alert_id
            )
            return AckResponse(success=r == "UPDATE 1")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/alerts/unresolved-count")
async def unresolved_count():
    try:
        async with db_pool.acquire() as c:
            n = await c.fetchval(
                "SELECT COUNT(*) FROM alerts WHERE acknowledged = FALSE"
            )
            return {"count": n}
    except Exception:
        return {"count": 0}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@app.get("/api/config")
async def get_config():
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                "SELECT key, value, updated_at FROM system_config ORDER BY key"
            )
            out = {}
            for r in rows:
                if "password" in r["key"].lower():
                    out[r["key"]] = "********"
                else:
                    out[r["key"]] = r["value"]
            return out
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/config")
async def set_config(body: ConfigUpdate):
    if "password" in body.key.lower() and body.value != "********":
        pass  # store as-is in real deployments, consider encryption
    try:
        async with db_pool.acquire() as c:
            await c.execute(
                """INSERT INTO system_config (key, value, updated_by)
                   VALUES ($1, $2, 'api_user')
                   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = 'api_user'""",
                body.key,
                body.value,
            )
            # Mirror to Redis for collector to pick up
            await redis.set(f"cfg:{body.key}", body.value)
            # If Deye credentials changed, signal collector to restart
            if body.key in ("deye_email", "deye_password_enc", "deye_inverter_sn"):
                await redis.set("collector:command", "restart")
            return {"success": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/config/tariff", response_model=Dict[str, bool])
async def set_tariff_config(body: TariffConfig):
    try:
        await redis.set("cfg:tariff_mode", body.mode)
        slabs_str = ",".join(f"{s.upper_kwh}:{s.rate}" for s in body.slabs) if body.slabs else ""
        await redis.set("cfg:tariff_slabs", slabs_str)
        nt_slabs_str = ",".join(f"{s.upper_kwh}:{s.rate}" for s in body.non_telescopic_slabs) if body.non_telescopic_slabs else ""
        await redis.set("cfg:tariff_non_telescopic", nt_slabs_str)
        await redis.set("cfg:billing_days", str(body.billing_days))
        await redis.set("cfg:feed_in_tariff", str(body.feed_in_tariff))
        await redis.set("cfg:grid_import_tariff", str(body.grid_import_tariff))
        await redis.set("cfg:currency", body.currency)
        if body.cycle_end_date:
            await redis.set("cfg:billing_cycle_end_date", body.cycle_end_date)
        else:
            await redis.delete("cfg:billing_cycle_end_date")
        await redis.set("collector:command", "restart")
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, str(e))


def _parse_slabs(s: str):
    if not s:
        return []
    slabs = []
    for part in s.split(","):
        try:
            upper, rate = part.split(":")
            slabs.append({"upper_kwh": int(upper), "rate": float(rate)})
        except ValueError:
            continue
    slabs.sort(key=lambda x: x["upper_kwh"])
    return slabs


@app.get("/api/config/tariff", response_model=TariffConfig)
async def get_tariff_config():
    try:
        mode = (await redis.get("cfg:tariff_mode")) or "telescopic"
        slabs_raw = (await redis.get("cfg:tariff_slabs")) or "50:3.35,100:4.25,150:5.35,200:7.20,250:8.50"
        nt_raw = (await redis.get("cfg:tariff_non_telescopic")) or "300:6.75,350:7.60,400:7.95,500:8.25,999999:9.20"
        billing_days = int((await redis.get("cfg:billing_days")) or "60")
        feed_in = float((await redis.get("cfg:feed_in_tariff")) or settings.feed_in_tariff)
        grid_import = float((await redis.get("cfg:grid_import_tariff")) or settings.grid_import_tariff)
        currency = (await redis.get("cfg:currency")) or settings.currency
        billing_kwh = float(await redis.get("collector:billing_kwh") or "0")
        cycle_start = await redis.get("consumption:billing:cycle_start")
        cycle_end_date = await redis.get("cfg:billing_cycle_end_date")
        active_rate = float(await redis.get("collector:tariff_rate") or "0")
        return TariffConfig(
            mode=mode,
            slabs=_parse_slabs(slabs_raw),
            non_telescopic_slabs=_parse_slabs(nt_raw),
            billing_days=billing_days,
            feed_in_tariff=feed_in,
            grid_import_tariff=grid_import,
            currency=currency,
            billing_kwh=round(billing_kwh, 2),
            cycle_start=cycle_start,
            cycle_end_date=cycle_end_date,
            active_rate=active_rate,
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/config/test-connection", response_model=ConnTestResult)
async def test_connection(body: DeyeCredentials):
    """Validate Deye cloud credentials and return discovered inverters."""
    if (
        not body.email
        or not body.password
        or not settings.deye_app_secret
        or not settings.deye_app_id
    ):
        return ConnTestResult(
            success=False, message="Email, password, app ID, and app secret required"
        )
    try:
        async with aiohttp.ClientSession() as s:
            pwd_hash = hashlib.sha256(body.password.encode()).hexdigest()
            async with s.post(
                f"{settings.deye_api_base}/account/token?appId={settings.deye_app_id}",
                json={
                    "appSecret": settings.deye_app_secret,
                    "email": body.email,
                    "password": pwd_hash,
                    "companyId": "0",
                },
                timeout=aiohttp.ClientTimeout(total=30),
            ) as r:
                d = await r.json()
                if d.get("code") != "1000000":
                    return ConnTestResult(
                        success=False,
                        message=f"Login failed: {d.get('msg', 'Unknown')}",
                    )
                token = d["accessToken"]
                async with s.post(
                    f"{settings.deye_api_base}/device/list",
                    json={"page": 1, "size": 20},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as r2:
                    d2 = await r2.json()
                    if d2.get("code") != "1000000":
                        return ConnTestResult(
                            success=True,
                            message="Authenticated but failed to list inverters",
                        )
                    inv_list = d2.get("deviceList", [])
                    return ConnTestResult(
                        success=True,
                        message=f"Authenticated. Found {len(inv_list)} inverter(s).",
                        inverters=[
                            {
                                "sn": i.get("deviceSn"),
                                "model": i.get("model"),
                                "status": str(i.get("deviceState", "")),
                            }
                            for i in inv_list
                        ],
                    )
    except asyncio.TimeoutError:
        return ConnTestResult(success=False, message="Connection timed out")
    except Exception as e:
        return ConnTestResult(success=False, message=f"Connection error: {str(e)}")


# ---------------------------------------------------------------------------
# Inverters
# ---------------------------------------------------------------------------
@app.get("/api/inverters")
async def list_inverters():
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                "SELECT * FROM inverters ORDER BY last_seen DESC NULLS LAST"
            )
            return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/inverters/{serial_number}")
async def get_inverter(serial_number: str):
    try:
        async with db_pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT * FROM inverters WHERE serial_number = $1", serial_number
            )
            if not row:
                raise HTTPException(404, "Inverter not found")
            return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Collector Status
# ---------------------------------------------------------------------------
@app.get("/api/collector/status", response_model=CollectorStatus)
async def collector_status():
    try:
        status = await redis.get("collector:status") or "unknown"
        count = int(await redis.get("collector:collection_count") or 0)
        errs = int(await redis.get("collector:error_count") or 0)
        last = await redis.get("collector:last_collection")
        buf = int(await redis.get("deye:buffer:telemetry") or 0)
        sn = await redis.get("deye:inverter_sn") or None
        bill = float(await redis.get("collector:billing_kwh") or 0)
        trf = float(await redis.get("collector:tariff_rate") or 0)
        return CollectorStatus(
            status=status,
            collection_count=count,
            error_count=errs,
            last_collection=last,
            buffer_size=buf,
            inverter_sn=sn,
            billing_kwh=bill,
            tariff_rate=trf,
        )
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Billing Cycles & Reports
# ---------------------------------------------------------------------------

class BillingCycle(BaseModel):
    cycle_start: str
    cycle_end: Optional[str] = None
    total_production_kwh: float = 0
    total_savings: float = 0
    total_grid_export_kwh: float = 0
    total_grid_import_kwh: float = 0
    total_load_kwh: float = 0
    avg_daily_production: float = 0
    avg_daily_savings: float = 0
    day_count: int = 0
    is_current: bool = False
    gap_kwh: float = 0


class CycleEndDate(BaseModel):
    end_date: str


class FinalizeCycleRequest(BaseModel):
    notes: str = ""


class BillingReport(BaseModel):
    id: int
    cycle_start: str
    cycle_end: str
    total_production_kwh: float
    total_savings: float
    total_grid_export_kwh: float
    total_grid_import_kwh: float
    total_load_kwh: float
    avg_daily_production: float
    avg_daily_savings: float
    day_count: int
    finalized_at: str
    notes: str = ""


class CycleStatus(BaseModel):
    has_end_date: bool
    end_date: str | None
    days_remaining: int | None
    is_past_end: bool
    current_cycle: BillingCycle | None


class GapRecord(BaseModel):
    id: int
    gap_start: str
    gap_end: str
    kwh_total_before: Optional[float] = None
    kwh_total_after: Optional[float] = None
    kwh_missed: float
    day_count: int = 0
    filled: bool = False
    created_at: str


class GapAlert(BaseModel):
    id: int
    inverter_sn: str
    gap_start: str
    gap_end: str
    kwh_missed: float
    total_before: Optional[float] = None
    total_after: Optional[float] = None
    daily_before: Optional[float] = None
    daily_after: Optional[float] = None
    status: str = "active"
    created_at: str


class ReconcileResult(BaseModel):
    gaps_found: int
    gaps_filled: int
    days_filled: int
    total_kwh_recovered: float = 0


@app.get("/api/analytics/billing-cycle/status", response_model=CycleStatus)
async def get_cycle_status():
    try:
        end_date_str = await redis.get("cfg:billing_cycle_end_date")
        current_row = await db_pool.fetchval(
            "SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL ORDER BY cycle_start DESC LIMIT 1"
        )
        current_cycle = None
        if current_row:
            async with db_pool.acquire() as c:
                row = await c.fetchrow(
                    """
                    SELECT
                        COALESCE(SUM(daily_production_kwh), 0) AS prod,
                        COALESCE(SUM(daily_savings), 0) AS sav,
                        COALESCE(SUM(total_grid_export_wh), 0) / 1000.0 AS exp,
                        COALESCE(SUM(total_grid_import_wh), 0) / 1000.0 AS imp,
                        COALESCE(SUM(total_load_wh), 0) / 1000.0 AS load,
                        COUNT(*) AS days
                    FROM telemetry_daily
                    WHERE day >= $1 AND day < CURRENT_DATE
                    """,
                    current_row,
                )
                row = dict(row) if row else None
                if row:
                    today_row = await c.fetchrow(
                        """SELECT
                            daily_production,
                            daily_savings,
                            daily_grid_export,
                            daily_grid_import,
                            daily_load_consumption
                        FROM telemetry
                        WHERE time >= CURRENT_DATE
                        ORDER BY time DESC
                        LIMIT 1"""
                    )
                    if today_row:
                        row["prod"] += (today_row["daily_production"] or 0)
                        row["sav"] += (today_row["daily_savings"] or 0)
                        row["exp"] += (today_row["daily_grid_export"] or 0)
                        row["imp"] += (today_row["daily_grid_import"] or 0)
                        row["load"] += (today_row["daily_load_consumption"] or 0)
                        row["days"] += 1
                    tariff_cfg = await _load_cycle_tariff()
                    fit = tariff_cfg["feed_in_tariff"]
                    import_rate = tariff_cfg["active_rate"]
                    self_use = row["prod"] - row["exp"]
                    row["sav"] = round(row["exp"] * fit + self_use * import_rate, 2)
                if row and row["days"] > 0:
                    days = row["days"]
                    cycle_gap = await c.fetchval(
                        """SELECT COALESCE(SUM(kwh_missed), 0)
                           FROM telemetry_gap_alerts
                           WHERE gap_start >= $1 AND status = 'active'""",
                        current_row,
                    ) or 0
                    current_cycle = BillingCycle(
                        cycle_start=current_row.isoformat(),
                        cycle_end=None,
                        total_production_kwh=round(row["prod"], 2),
                        total_savings=round(row["sav"], 2),
                        total_grid_export_kwh=round(row["exp"], 2),
                        total_grid_import_kwh=round(row["imp"], 2),
                        total_load_kwh=round(row["load"], 2),
                        avg_daily_production=round(row["prod"] / days, 2),
                        avg_daily_savings=round(row["sav"] / days, 2),
                        day_count=days,
                        is_current=True,
                        gap_kwh=round(float(cycle_gap), 2),
                    )
        if not end_date_str:
            return CycleStatus(
                has_end_date=False, end_date=None,
                days_remaining=None, is_past_end=False,
                current_cycle=current_cycle,
            )
        end_date = datetime.fromisoformat(end_date_str)
        now = datetime.now(timezone.utc)
        days_remaining = (end_date - now).days
        return CycleStatus(
            has_end_date=True, end_date=end_date_str,
            days_remaining=days_remaining if days_remaining > 0 else 0,
            is_past_end=now >= end_date,
            current_cycle=current_cycle,
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/analytics/billing-cycle/end-date")
async def set_cycle_end_date(body: CycleEndDate):
    try:
        await redis.set("cfg:billing_cycle_end_date", body.end_date)
        return {"success": True, "end_date": body.end_date}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/analytics/billing-cycle/end-date")
async def clear_cycle_end_date():
    try:
        await redis.delete("cfg:billing_cycle_end_date")
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/analytics/billing-cycle/finalize")
async def finalize_cycle(body: FinalizeCycleRequest):
    try:
        async with db_pool.acquire() as c:
            current = await c.fetchrow(
                "SELECT * FROM billing_cycles WHERE cycle_end IS NULL ORDER BY cycle_start DESC LIMIT 1"
            )
            if not current:
                return {"success": False, "message": "No active cycle to finalize"}
            cycle_end = datetime.now(timezone.utc)
            end_date_str = await redis.get("cfg:billing_cycle_end_date")
            if end_date_str:
                cycle_end = datetime.fromisoformat(end_date_str).replace(tzinfo=timezone.utc)
            row = await c.fetchrow(
                """SELECT
                    COALESCE(SUM(daily_production_kwh), 0) AS prod,
                    COALESCE(SUM(daily_savings), 0) AS sav,
                    COALESCE(SUM(total_grid_export_wh), 0) / 1000.0 AS exp,
                    COALESCE(SUM(total_grid_import_wh), 0) / 1000.0 AS imp,
                    COALESCE(SUM(total_load_wh), 0) / 1000.0 AS load,
                    COUNT(*) AS days
                FROM telemetry_daily
                WHERE day >= $1 AND day < $2""",
                current["cycle_start"], cycle_end,
            )
            days = row["days"] if row else 0
            prod = round(row["prod"], 2) if row else 0
            sav = round(row["sav"], 2) if row else 0
            exp = round(row["exp"], 2) if row else 0
            imp = round(row["imp"], 2) if row else 0
            load = round(row["load"], 2) if row else 0
            avg_prod = round(row["prod"] / days, 2) if row and days > 0 else 0
            avg_sav = round(row["sav"] / days, 2) if row and days > 0 else 0

            await c.execute(
                """UPDATE billing_cycles SET
                    cycle_end = $1,
                    total_production_kwh = $2,
                    total_savings = $3,
                    total_grid_export_kwh = $4,
                    total_grid_import_kwh = $5,
                    total_load_kwh = $6,
                    avg_daily_production = $7,
                    avg_daily_savings = $8,
                    day_count = $9
                WHERE cycle_start = $10""",
                cycle_end, prod, sav, exp, imp, load, avg_prod, avg_sav, days,
                current["cycle_start"],
            )
            await c.execute(
                """INSERT INTO billing_reports
                   (cycle_start, cycle_end, total_production_kwh, total_savings,
                    total_grid_export_kwh, total_grid_import_kwh, total_load_kwh,
                    avg_daily_production, avg_daily_savings, day_count, notes)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                current["cycle_start"], cycle_end,
                prod, sav, exp, imp, load, avg_prod, avg_sav, days,
                body.notes,
            )
            await redis.delete("cfg:billing_cycle_end_date")
            await redis.delete("consumption:billing:cycle_start_date")
            new_start = (cycle_end + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            await c.execute(
                """INSERT INTO billing_cycles (cycle_start) VALUES ($1)""",
                new_start,
            )
            await redis.set("consumption:billing:cycle_start_date", new_start.isoformat())
            return {
                "success": True,
                "message": f"Cycle finalized: {current['cycle_start'].date()} to {cycle_end.date()}",
                "report_id": await c.fetchval("SELECT id FROM billing_reports ORDER BY id DESC LIMIT 1"),
            }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/billing-reports", response_model=List[BillingReport])
async def get_billing_reports(limit: int = Query(12, le=120)):
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                """SELECT * FROM billing_reports ORDER BY cycle_start DESC LIMIT $1""",
                limit,
            )
            return [
                BillingReport(
                    id=r["id"],
                    cycle_start=r["cycle_start"].isoformat(),
                    cycle_end=r["cycle_end"].isoformat(),
                    total_production_kwh=round(r["total_production_kwh"] or 0, 2),
                    total_savings=round(r["total_savings"] or 0, 2),
                    total_grid_export_kwh=round(r["total_grid_export_kwh"] or 0, 2),
                    total_grid_import_kwh=round(r["total_grid_import_kwh"] or 0, 2),
                    total_load_kwh=round(r["total_load_kwh"] or 0, 2),
                    avg_daily_production=round(r["avg_daily_production"] or 0, 2),
                    avg_daily_savings=round(r["avg_daily_savings"] or 0, 2),
                    day_count=r["day_count"] or 0,
                    finalized_at=r["finalized_at"].isoformat(),
                    notes=r["notes"] or "",
                )
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/billing-cycles", response_model=List[BillingCycle])
async def analytics_billing_cycles(months: int = Query(6, le=60)):
    try:
        async with db_pool.acquire() as c:
            cutoff = datetime.now(timezone.utc) - timedelta(days=months * 30)
            rows = await c.fetch(
                """SELECT cycle_start, cycle_end,
                          total_production_kwh, total_savings,
                          total_grid_export_kwh, total_grid_import_kwh,
                          total_load_kwh, avg_daily_production, avg_daily_savings,
                          day_count
                   FROM billing_cycles
                   WHERE cycle_start >= $1
                   ORDER BY cycle_start DESC""",
                cutoff,
            )
            result = []
            for r in rows:
                is_current = r["cycle_end"] is None
                if is_current:
                    live = await c.fetchrow(
                        """SELECT
                            COALESCE(SUM(daily_production_kwh), 0) AS prod,
                            COALESCE(SUM(daily_savings), 0) AS sav,
                            COALESCE(SUM(total_grid_export_wh), 0) / 1000.0 AS exp,
                            COALESCE(SUM(total_grid_import_wh), 0) / 1000.0 AS imp,
                            COALESCE(SUM(total_load_wh), 0) / 1000.0 AS load,
                            COUNT(*) AS days
                        FROM telemetry_daily
                        WHERE day >= $1 AND day < CURRENT_DATE""",
                        r["cycle_start"],
                    )
                    live = dict(live)
                    today_row = await c.fetchrow(
                        """SELECT
                            daily_production,
                            daily_savings,
                            daily_grid_export,
                            daily_grid_import,
                            daily_load_consumption
                        FROM telemetry
                        WHERE time >= CURRENT_DATE
                        ORDER BY time DESC
                        LIMIT 1"""
                    )
                    if today_row:
                        live["prod"] += (today_row["daily_production"] or 0)
                        live["sav"] += (today_row["daily_savings"] or 0)
                        live["exp"] += (today_row["daily_grid_export"] or 0)
                        live["imp"] += (today_row["daily_grid_import"] or 0)
                        live["load"] += (today_row["daily_load_consumption"] or 0)
                        live["days"] += 1
                    tariff_cfg = await _load_cycle_tariff()
                    fit = tariff_cfg["feed_in_tariff"]
                    import_rate = tariff_cfg["active_rate"]
                    self_use = live["prod"] - live["exp"]
                    live["sav"] = round(live["exp"] * fit + self_use * import_rate, 2)
                    days = live["days"]
                    cycle_gap = await c.fetchval(
                        """SELECT COALESCE(SUM(kwh_missed), 0)
                           FROM telemetry_gap_alerts
                           WHERE gap_start >= $1 AND status = 'active'""",
                        r["cycle_start"],
                    ) or 0
                    if days > 0:
                        result.append(BillingCycle(
                            cycle_start=r["cycle_start"].isoformat(),
                            cycle_end=None,
                            total_production_kwh=round(live["prod"], 2),
                            total_savings=round(live["sav"], 2),
                            total_grid_export_kwh=round(live["exp"], 2),
                            total_grid_import_kwh=round(live["imp"], 2),
                            total_load_kwh=round(live["load"], 2),
                            avg_daily_production=round(live["prod"] / days, 2),
                            avg_daily_savings=round(live["sav"] / days, 2),
                            day_count=days,
                            is_current=True,
                            gap_kwh=round(float(cycle_gap), 2),
                        ))
                    else:
                        result.append(BillingCycle(
                            cycle_start=r["cycle_start"].isoformat(),
                            cycle_end=None,
                            is_current=True,
                            gap_kwh=round(float(cycle_gap), 2),
                        ))
                else:
                    result.append(BillingCycle(
                        cycle_start=r["cycle_start"].isoformat(),
                        cycle_end=r["cycle_end"].isoformat(),
                        total_production_kwh=round(r["total_production_kwh"] or 0, 2),
                        total_savings=round(r["total_savings"] or 0, 2),
                        total_grid_export_kwh=round(r["total_grid_export_kwh"] or 0, 2),
                        total_grid_import_kwh=round(r["total_grid_import_kwh"] or 0, 2),
                        total_load_kwh=round(r["total_load_kwh"] or 0, 2),
                        avg_daily_production=round(r["avg_daily_production"] or 0, 2),
                        avg_daily_savings=round(r["avg_daily_savings"] or 0, 2),
                        day_count=r["day_count"] or 0,
                        is_current=False,
                    ))
            return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/analytics/billing-cycles/backfill")
async def backfill_billing_cycles():
    try:
        async with db_pool.acquire() as c:
            earliest = await c.fetchval("SELECT MIN(day) FROM telemetry_daily")
            if not earliest:
                return {"backfilled": 0, "message": "No daily data found"}
            start_day = int((await redis.get("cfg:billing_cycle_start_day")) or "1")
            now = datetime.now(timezone.utc)
            cursor = earliest.replace(tzinfo=timezone.utc)
            backfilled = 0
            while cursor < now:
                cycle_start = get_cycle_start(cursor, start_day)
                if cycle_start.month != cursor.month or cycle_start.year != cursor.year:
                    cursor = cycle_start
                    continue
                next_start = get_cycle_start(
                    (cycle_start + timedelta(days=32)).replace(day=1), start_day
                )
                existing = await c.fetchval(
                    "SELECT 1 FROM billing_cycles WHERE cycle_start = $1", cycle_start
                )
                if not existing and next_start <= now:
                    row = await c.fetchrow(
                        """SELECT
                            COALESCE(SUM(daily_production_kwh), 0) AS prod,
                            COALESCE(SUM(daily_savings), 0) AS sav,
                            COALESCE(SUM(total_grid_export_wh), 0) / 1000.0 AS exp,
                            COALESCE(SUM(total_grid_import_wh), 0) / 1000.0 AS imp,
                            COALESCE(SUM(total_load_wh), 0) / 1000.0 AS load,
                            COUNT(*) AS days
                        FROM telemetry_daily
                        WHERE day >= $1 AND day < $2""",
                        cycle_start, next_start,
                    )
                    if row and row["days"] > 0:
                        await c.execute(
                            """INSERT INTO billing_cycles
                               (cycle_start, cycle_end, total_production_kwh, total_savings,
                                total_grid_export_kwh, total_grid_import_kwh, total_load_kwh,
                                avg_daily_production, avg_daily_savings, day_count)
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
                            cycle_start, next_start,
                            round(row["prod"], 2), round(row["sav"], 2),
                            round(row["exp"], 2), round(row["imp"], 2),
                            round(row["load"], 2),
                            round(row["prod"] / row["days"], 2),
                            round(row["sav"] / row["days"], 2),
                            row["days"],
                        )
                        backfilled += 1
                cursor = next_start
            return {"backfilled": backfilled}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/analytics/billing-reports/backfill")
async def backfill_billing_reports():
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                "SELECT id, cycle_start, cycle_end FROM billing_reports WHERE day_count = 0 ORDER BY cycle_start ASC"
            )
            updated = 0
            for r in rows:
                row = await c.fetchrow(
                    """SELECT
                        COALESCE(SUM(daily_production_kwh), 0) AS prod,
                        COALESCE(SUM(daily_savings), 0) AS sav,
                        COALESCE(SUM(total_grid_export_wh), 0) / 1000.0 AS exp,
                        COALESCE(SUM(total_grid_import_wh), 0) / 1000.0 AS imp,
                        COALESCE(SUM(total_load_wh), 0) / 1000.0 AS load,
                        COUNT(*) AS days
                    FROM telemetry_daily
                    WHERE day >= $1 AND day < $2""",
                    r["cycle_start"], r["cycle_end"],
                )
                days = row["days"]
                if days > 0:
                    prod = round(row["prod"], 2)
                    sav = round(row["sav"], 2)
                    exp = round(row["exp"], 2)
                    imp = round(row["imp"], 2)
                    load = round(row["load"], 2)
                    avg_prod = round(row["prod"] / days, 2)
                    avg_sav = round(row["sav"] / days, 2)
                    await c.execute(
                        """UPDATE billing_reports SET
                            total_production_kwh = $1, total_savings = $2,
                            total_grid_export_kwh = $3, total_grid_import_kwh = $4,
                            total_load_kwh = $5, avg_daily_production = $6,
                            avg_daily_savings = $7, day_count = $8
                        WHERE id = $9""",
                        prod, sav, exp, imp, load, avg_prod, avg_sav, days,
                        r["id"],
                    )
                    updated += 1
            return {"updated": updated}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Gap Reconciliation — detect & backfill missing telemetry intervals
# ---------------------------------------------------------------------------
@app.post("/api/analytics/reconcile", response_model=ReconcileResult)
async def reconcile_telemetry_gaps():
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                """SELECT time, total_production, daily_production, inverter_sn
                   FROM telemetry
                   WHERE total_production IS NOT NULL
                   ORDER BY time ASC"""
            )
        gaps_found = 0
        gaps_filled = 0
        days_filled_set: set = set()
        total_kwh = 0.0

        fit = float(await redis.get("cfg:feed_in_tariff") or "3.50")
        git = float(await redis.get("cfg:grid_import_tariff") or "6.00")

        for i in range(1, len(rows)):
            prev = rows[i - 1]
            curr = rows[i]
            pv_total = prev["total_production"]
            cv_total = curr["total_production"]
            pv_daily = prev.get("daily_production")
            cv_daily = curr.get("daily_production")
            if pv_total is None or cv_total is None or cv_total <= pv_total:
                continue

            lifetime_delta = cv_total - pv_total
            if pv_daily is not None and cv_daily is not None:
                if cv_daily >= pv_daily:
                    daily_delta = cv_daily - pv_daily
                else:
                    daily_delta = cv_daily
            else:
                daily_delta = 0

            gap_kwh = lifetime_delta - daily_delta
            if gap_kwh <= 0.001:
                continue

            gap_start = prev["time"]
            gap_end = curr["time"]
            total_kwh += gap_kwh
            gaps_found += 1

            day_cursor = gap_start.replace(hour=0, minute=0, second=0, microsecond=0)
            day_slices: list[tuple[datetime, float]] = []
            while day_cursor < gap_end:
                day_end = day_cursor + timedelta(days=1)
                overlap_start = max(gap_start, day_cursor)
                overlap_end = min(gap_end, day_end)
                secs = (overlap_end - overlap_start).total_seconds()
                if secs > 0:
                    day_slices.append((day_cursor, secs))
                day_cursor = day_end

            total_secs = sum(s for _, s in day_slices)
            if total_secs <= 0:
                continue

            async with db_pool.acquire() as c:
                for day_dt, secs in day_slices:
                    day_kwh = gap_kwh * (secs / total_secs)
                    day_savings = day_kwh * git
                    await c.execute(
                        """INSERT INTO telemetry_daily_gaps
                               (day, inverter_sn, daily_production_kwh, daily_savings, sample_count)
                           VALUES ($1, $2, $3, $4, $5)
                           ON CONFLICT (day, inverter_sn) DO UPDATE SET
                               daily_production_kwh = EXCLUDED.daily_production_kwh,
                               daily_savings = EXCLUDED.daily_savings,
                               sample_count = EXCLUDED.sample_count""",
                        day_dt.date(),
                        prev["inverter_sn"],
                        round(day_kwh, 4),
                        round(day_savings, 4),
                        1,
                    )
                    days_filled_set.add(day_dt.date())

                await c.execute(
                    """INSERT INTO telemetry_gaps_audit
                           (gap_start, gap_end, kwh_total_before, kwh_total_after,
                            kwh_missed, day_count, filled)
                       VALUES ($1, $2, $3, $4, $5, $6, TRUE)""",
                    gap_start,
                    gap_end,
                    pv_total,
                    cv_total,
                    round(gap_kwh, 4),
                    len(day_slices),
                )
                await c.execute(
                    """INSERT INTO telemetry_gap_alerts
                           (inverter_sn, gap_start, gap_end, kwh_missed,
                            total_before, total_after, daily_before, daily_after)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                    prev["inverter_sn"],
                    gap_start,
                    gap_end,
                    round(gap_kwh, 4),
                    round(pv_total, 4),
                    round(cv_total, 4),
                    round(pv_daily, 4) if pv_daily else 0,
                    round(cv_daily, 4) if cv_daily else 0,
                )
            gaps_filled += 1

        return ReconcileResult(
            gaps_found=gaps_found,
            gaps_filled=gaps_filled,
            days_filled=len(days_filled_set),
            total_kwh_recovered=round(total_kwh, 2),
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/gap-report", response_model=List[GapRecord])
async def gap_report(limit: int = Query(50, le=500)):
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                """SELECT id, gap_start, gap_end,
                          kwh_total_before, kwh_total_after,
                          kwh_missed, day_count, filled, created_at
                   FROM telemetry_gaps_audit
                   ORDER BY created_at DESC
                   LIMIT $1""",
                limit,
            )
            return [
                GapRecord(
                    id=r["id"],
                    gap_start=r["gap_start"].isoformat(),
                    gap_end=r["gap_end"].isoformat(),
                    kwh_total_before=r["kwh_total_before"],
                    kwh_total_after=r["kwh_total_after"],
                    kwh_missed=r["kwh_missed"],
                    day_count=r["day_count"],
                    filled=r["filled"],
                    created_at=r["created_at"].isoformat(),
                )
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/gap-alerts", response_model=List[GapAlert])
async def gap_alerts(limit: int = Query(50, le=500)):
    try:
        async with db_pool.acquire() as c:
            rows = await c.fetch(
                """SELECT id, inverter_sn, gap_start, gap_end,
                          kwh_missed, total_before, total_after,
                          daily_before, daily_after, status, created_at
                   FROM telemetry_gap_alerts
                   ORDER BY created_at DESC
                   LIMIT $1""",
                limit,
            )
            return [
                GapAlert(
                    id=r["id"],
                    inverter_sn=r["inverter_sn"],
                    gap_start=r["gap_start"].isoformat(),
                    gap_end=r["gap_end"].isoformat(),
                    kwh_missed=r["kwh_missed"],
                    total_before=r["total_before"],
                    total_after=r["total_after"],
                    daily_before=r["daily_before"],
                    daily_after=r["daily_after"],
                    status=r["status"],
                    created_at=r["created_at"].isoformat(),
                )
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# Push Notifications (Firebase Cloud Messaging)
# ---------------------------------------------------------------------------
_firebase_app = None

def _ensure_firebase():
    global _firebase_app
    if _firebase_app is None and settings.firebase_credentials_path:
        try:
            import firebase_admin
            from firebase_admin import credentials
            cred = credentials.Certificate(settings.firebase_credentials_path)
            _firebase_app = firebase_admin.initialize_app(cred)
        except Exception as e:
            log.warning("Firebase init failed: %s", e)


async def send_push_to_all(title: str, body: str, data: dict | None = None):
    if not settings.firebase_credentials_path:
        return
    _ensure_firebase()
    if _firebase_app is None:
        return
    try:
        from firebase_admin import messaging
        async with db_pool.acquire() as c:
            rows = await c.fetch("SELECT token FROM push_tokens")
        for row in rows:
            try:
                msg = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data={k: str(v) for k, v in (data or {}).items()},
                    token=row["token"],
                )
                messaging.send(msg)
            except Exception as e:
                log.error("Push send to token failed: %s", e)
    except Exception as e:
        log.error("Push broadcast failed: %s", e)


class PushTokenRequest(BaseModel):
    token: str
    platform: str = "android"


@app.post("/api/push/register")
async def register_push_token(req: PushTokenRequest):
    try:
        async with db_pool.acquire() as c:
            await c.execute(
                """INSERT INTO push_tokens (token, platform)
                   VALUES ($1, $2)
                   ON CONFLICT (token) DO UPDATE SET
                       platform = EXCLUDED.platform,
                       updated_at = NOW()""",
                req.token,
                req.platform,
            )
        log.info("Push token registered: %s…", req.token[:20])
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/push/unregister")
async def unregister_push_token(req: PushTokenRequest):
    try:
        async with db_pool.acquire() as c:
            await c.execute("DELETE FROM push_tokens WHERE token = $1", req.token)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# WebSocket — Realtime Telemetry
# ---------------------------------------------------------------------------
@app.websocket("/api/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    token = ws.query_params.get("token")
    if token:
        payload = _verify_token(token, settings.secret_key)
        if not payload:
            await ws.close(code=4001, reason="Invalid token")
            return
    await ws_mgr.connect_telemetry(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_mgr.disconnect_telemetry(ws)
    except Exception:
        ws_mgr.disconnect_telemetry(ws)


@app.websocket("/api/ws/alerts")
async def ws_alerts(ws: WebSocket):
    token = ws.query_params.get("token")
    if token:
        payload = _verify_token(token, settings.secret_key)
        if not payload:
            await ws.close(code=4001, reason="Invalid token")
            return
    await ws_mgr.connect_alert(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_mgr.disconnect_alert(ws)
    except Exception:
        ws_mgr.disconnect_alert(ws)


# ---------------------------------------------------------------------------
# Static files & root
# ---------------------------------------------------------------------------
import pathlib

_static = pathlib.Path(__file__).parent / "static"
_static.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory=str(_static)), name="static")


@app.get("/")
async def root():
    index = _static / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse(
        {
            "service": "Solar Energy Intelligence Platform",
            "version": "1.0.0",
            "docs": "/docs",
        }
    )
