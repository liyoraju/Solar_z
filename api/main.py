"""
Solar Energy Intelligence Platform — API Service
=================================================
FastAPI application providing REST endpoints, WebSocket realtime feeds,
alert management, configuration UI, and analytics for the Deye SUN-3K-G03.
"""

import asyncio
import hashlib
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import aiohttp
import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

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
    feed_in_tariff: float = float(os.getenv("FEED_IN_TARIFF", "0.10"))
    grid_import_tariff: float = float(os.getenv("GRID_IMPORT_TARIFF", "0.28"))
    currency: str = os.getenv("CURRENCY", "USD")


settings = Settings()

# ---------------------------------------------------------------------------
# Globals (set during lifespan)
# ---------------------------------------------------------------------------
db_pool: Optional[asyncpg.Pool] = None
redis: Optional[aioredis.Redis] = None


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
    fault_active: bool = False
    uptime_samples: int = 0


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


class HealthResult(BaseModel):
    status: str = "ok"
    postgres: bool = False
    redis: bool = False
    uptime: float = 0


class AckResponse(BaseModel):
    success: bool


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
                except Exception:
                    pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.warning("Redis pub-sub bridge error: %s — reconnecting in 5s", e)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
_start_time = datetime.now(timezone.utc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis
    db_pool = await asyncpg.create_pool(settings.database_url, min_size=3, max_size=15)
    redis = aioredis.from_url(
        settings.redis_url, decode_responses=True, max_connections=10
    )
    await redis.ping()
    log.info("Connected to PostgreSQL and Redis")

    bridge_task = asyncio.create_task(redis_bridge())
    yield
    bridge_task.cancel()
    if db_pool:
        await db_pool.close()
    if redis:
        await redis.close()
    log.info("Shutdown complete")


app = FastAPI(title="Solar Intelligence Platform", version="1.0.0", lifespan=lifespan)


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
    interval: str = Query("1 hour", regex=r"^\d+\s+(second|minute|hour|day)$"),
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
            rows = await c.fetch(
                f"""
                SELECT
                    time_bucket('{interval}', time)::text AS time,
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
                GROUP BY time_bucket('{interval}', time)
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
            q = """SELECT day::text AS time, avg_pv1_power, peak_pv1_power,
                          avg_inverter_power, peak_inverter_power,
                          max_temperature, avg_frequency,
                          daily_production_kwh, daily_savings, sample_count
                   FROM telemetry_daily WHERE day >= NOW() - ($1 || ' days')::INTERVAL """
            params: list = [str(days)]
            if sn:
                q += " AND inverter_sn = $2"
                params.append(sn)
            q += " ORDER BY day DESC"
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
                fault_active=bool(
                    latest["fault_code"] and int(latest["fault_code"]) != 0
                ),
            )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/analytics/financial")
async def analytics_financial():
    try:
        async with db_pool.acquire() as c:
            row = await c.fetchrow("""
                SELECT
                    MAX(total_production) AS total_kwh,
                    MAX(total_grid_export) AS total_export_kwh,
                    MAX(total_grid_import) AS total_import_kwh,
                    MAX(total_savings) AS total_savings,
                    MAX(daily_production) AS today_kwh,
                    MAX(daily_savings) AS today_savings
                FROM telemetry ORDER BY time DESC LIMIT 1
            """)
            if not row:
                return {}
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
        return CollectorStatus(
            status=status,
            collection_count=count,
            error_count=errs,
            last_collection=last,
            buffer_size=buf,
            inverter_sn=sn,
        )
    except Exception as e:
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# WebSocket — Realtime Telemetry
# ---------------------------------------------------------------------------
@app.websocket("/api/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
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
