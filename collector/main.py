"""
Deye Cloud API Telemetry Collector
===================================
Polls the Deye cloud platform for SUN-3K-G03 inverter telemetry,
normalises vendor payloads, buffers during outages, evaluates alert
rules, and publishes to Redis pub-sub + TimescaleDB.
"""

import asyncio
import hashlib
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import aiohttp
import asyncpg
import redis.asyncio as aioredis
from aiohttp import web


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
class Cfg:
    API_BASE = os.getenv("DEYE_API_BASE_URL", "https://api.deyecloud.com")
    APP_ID = os.getenv("DEYE_APP_ID", "")
    APP_SECRET = os.getenv("DEYE_APP_SECRET", "")
    EMAIL = os.getenv("DEYE_EMAIL", "")
    PASSWORD = os.getenv("DEYE_PASSWORD", "")
    INVERTER_SN = os.getenv("DEYE_INVERTER_SN", "")
    TOKEN_REFRESH_BUF = int(os.getenv("DEYE_TOKEN_REFRESH_BUFFER", "300"))
    INTERVAL = int(os.getenv("COLLECTOR_INTERVAL", "10"))
    HISTORY_INTERVAL = int(os.getenv("HISTORY_SYNC_INTERVAL", "300"))
    BUFFER_MAX = int(os.getenv("BUFFER_MAX_SIZE", "10000"))
    REDIS_URL = os.getenv("REDIS_URL", "redis://:redis_secure_2024@redis:6379/0")
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://solar:solar_secure_2024@postgres:5432/solar_platform",
    )
    FEED_IN_TARIFF = float(os.getenv("FEED_IN_TARIFF", "3.50"))
    GRID_IMPORT_TARIFF = float(os.getenv("GRID_IMPORT_TARIFF", "6.00"))
    TARIFF_MODE = os.getenv("TARIFF_MODE", "telescopic")
    TARIFF_SLABS = os.getenv("TARIFF_SLABS", "50:3.35,100:4.25,150:5.35,200:7.20,250:8.50")
    TARIFF_NT = os.getenv("TARIFF_NON_TELESCOPIC", "300:6.75,350:7.60,400:7.95,500:8.25,999999:9.20")
    BILLING_DAYS = int(os.getenv("BILLING_DAYS", "60"))
    ALERT_TEMP_HI = float(os.getenv("ALERT_TEMP_HIGH", "75"))
    ALERT_V_LO = float(os.getenv("ALERT_VOLTAGE_LOW", "180"))
    ALERT_V_HI = float(os.getenv("ALERT_VOLTAGE_HIGH", "264"))
    ALERT_F_LO = float(os.getenv("ALERT_FREQ_LOW", "47.5"))
    ALERT_F_HI = float(os.getenv("ALERT_FREQ_HIGH", "50.5"))
    ALERT_SOC_LO = float(os.getenv("ALERT_BATTERY_SOC_LOW", "10"))
    ALERT_OFFLINE_S = int(os.getenv("ALERT_OFFLINE_SECONDS", "120"))

    @staticmethod
    def _parse_slabs(s):
        slabs = []
        for part in s.split(","):
            upper, rate = part.split(":")
            slabs.append((int(upper), float(rate)))
        slabs.sort(key=lambda x: x[0])
        return slabs

    @staticmethod
    def effective_import_tariff(total_kwh):
        raw = Cfg.TARIFF_NT if Cfg.TARIFF_MODE == "non_telescopic" else Cfg.TARIFF_SLABS
        slabs = Cfg._parse_slabs(raw)
        if not slabs:
            return Cfg.GRID_IMPORT_TARIFF
        prev = 0
        for upper, rate in slabs:
            if prev < total_kwh <= upper:
                return rate
            prev = upper
        return slabs[-1][1]


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("collector")


# ---------------------------------------------------------------------------
# Deye authentication
# ---------------------------------------------------------------------------
class DeyeAuth:
    def __init__(self, session: aiohttp.ClientSession):
        self.s = session
        self.base = Cfg.API_BASE
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.expires_at: float = 0
        self._lock = asyncio.Lock()

    async def login(self) -> bool:
        if not Cfg.EMAIL or not Cfg.PASSWORD or not Cfg.APP_SECRET or not Cfg.APP_ID:
            log.error("Deye credentials not configured (need APP_ID & APP_SECRET)")
            return False
        async with self._lock:
            try:
                pwd_hash = hashlib.sha256(Cfg.PASSWORD.encode()).hexdigest()
                async with self.s.post(
                    f"{self.base}/account/token?appId={Cfg.APP_ID}",
                    json={
                        "appSecret": Cfg.APP_SECRET,
                        "email": Cfg.EMAIL,
                        "password": pwd_hash,
                        "companyId": "0",
                    },
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as r:
                    d = await r.json()
                    if d.get("code") != "1000000":
                        log.error("Login failed: %s", d.get("msg"))
                        return False
                    self.access_token = d["accessToken"]
                    self.refresh_token = d.get("refreshToken")
                    self.expires_at = (
                        time.time()
                        + int(d.get("expiresIn", 7200))
                        - Cfg.TOKEN_REFRESH_BUF
                    )
                    log.info("Authenticated with Deye cloud")
                    return True
            except Exception as e:
                log.error("Login error: %s", e)
                return False

    async def token(self) -> Optional[str]:
        if time.time() > self.expires_at:
            log.info("Token near expiry — refreshing")
            if not await self._refresh():
                if not await self.login():
                    return None
        return self.access_token

    async def _refresh(self) -> bool:
        if not self.refresh_token:
            return False
        try:
            async with self.s.post(
                f"{self.base}/account/token?appId={Cfg.APP_ID}",
                json={"appSecret": Cfg.APP_SECRET, "refreshToken": self.refresh_token},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                d = await r.json()
                if d.get("code") != "1000000":
                    return False
                self.access_token = d["accessToken"]
                self.refresh_token = d.get("refreshToken", self.refresh_token)
                self.expires_at = (
                    time.time() + int(d.get("expiresIn", 7200)) - Cfg.TOKEN_REFRESH_BUF
                )
                log.info("Token refreshed")
                return True
        except Exception:
            return False

    async def save(self, rd: aioredis.Redis):
        if self.access_token:
            ttl = max(1, int(self.expires_at - time.time()))
            await rd.set("deye:access_token", self.access_token, ex=ttl)
            if self.refresh_token:
                await rd.set("deye:refresh_token", self.refresh_token)


# ---------------------------------------------------------------------------
# Telemetry client with retry + circuit-breaker
# ---------------------------------------------------------------------------
_V1_KEY_MAP = {
    "DCVoltagePV1": "pv1V",
    "DCCurrentPV1": "pv1I",
    "DCPowerPV1": "pv1P",
    "DCVoltagePV2": "pv2V",
    "DCCurrentPV2": "pv2I",
    "DCPowerPV2": "pv2P",
    "ACVoltageRUA": "gridV_R",
    "ACVoltageSVB": "gridV_S",
    "ACVoltageTWC": "gridV_T",
    "ACCurrentRUA": "gridI_R",
    "ACCurrentSVB": "gridI_S",
    "ACCurrentTWC": "gridI_T",
    "ACOutputFrequencyR": "gridFreq",
    "TotalActiveACOutputPower": "invP",
    "TotalActiveProduction": "eTotal",
    "DailyActiveProduction": "eDay",
    "TotalGridFeedIn": "eDayToGrid",
    "TotalEnergyPurchased": "eDayFromGrid",
    "TotalConsumptionPower": "loadP",
    "InverterTemp": "invTemp",
    "InverterTemperature": "invTemp",
    "BatterySOC": "batSOC",
    "BatteryPower": "batP",
    "BatteryVoltage": "batV",
    "GridPowerToGrid": "gridPToGrid",
    "GridPowerFromGrid": "gridPFromGrid",
    "FaultCode": "faultCode",
    "WarningCode": "warningCode",
    "InverterStatus": "invStatus",
    "WorkingMode": "workMode",
    "TotalLoadConsumption": "eTotalLoad",
    "DailyLoadConsumption": "eDayLoad",
    "PVTotalPower": "pv1P",
}


class DeyeClient:
    def __init__(self, session: aiohttp.ClientSession, auth: DeyeAuth):
        self.s = session
        self.auth = auth
        self.base = Cfg.API_BASE
        self.sn: Optional[str] = Cfg.INVERTER_SN or None
        self._fails = 0
        self._open_until = 0.0

    async def _headers(self) -> Optional[Dict[str, str]]:
        t = await self.auth.token()
        return {"Authorization": f"Bearer {t}"} if t else None

    async def inverter_list(self) -> Optional[List[Dict]]:
        h = await self._headers()
        if not h:
            return None
        try:
            async with self.s.post(
                f"{self.base}/device/list",
                json={"page": 1, "size": 50},
                headers=h,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                d = await r.json()
                if d.get("code") == "1000000":
                    return d.get("deviceList", [])
                if d.get("code") == "2101019":
                    await self.auth.login()
                return None
        except Exception as e:
            log.error("inverter_list error: %s", e)
            return None

    async def _resolve_sn(self) -> bool:
        if self.sn:
            return True
        lst = await self.inverter_list()
        if lst:
            self.sn = lst[0].get("deviceSn") or lst[0].get("sn")
            Cfg.INVERTER_SN = self.sn
            if self.sn:
                log.info("Auto-detected inverter SN: %s", self.sn)
                return True
        return False

    async def realtime(self) -> Optional[Dict]:
        if time.time() < self._open_until:
            return None
        if not await self._resolve_sn():
            return None
        for attempt in range(4):
            h = await self._headers()
            if not h:
                return None
            try:
                async with self.s.post(
                    f"{self.base}/device/latest",
                    json={"deviceList": [self.sn]},
                    headers=h,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as r:
                    d = await r.json()
                    if d.get("code") == "1000000":
                        self._fails = 0
                        devices = d.get("deviceDataList", [])
                        if devices:
                            dev = devices[0]
                            flat = {"sn": dev.get("deviceSn", self.sn)}
                            ct = dev.get("collectionTime")
                            if ct:
                                flat["time"] = datetime.fromtimestamp(
                                    ct, tz=timezone.utc
                                ).isoformat()
                            for item in dev.get("dataList", []):
                                k = _V1_KEY_MAP.get(item["key"], item["key"])
                                flat[k] = item["value"]
                            return flat
                        return None
                    if d.get("code") == "2101019":
                        await self.auth.login()
                        continue
                    log.warning("API error (attempt %d): %s", attempt + 1, d.get("msg"))
            except asyncio.TimeoutError:
                log.warning("Timeout (attempt %d)", attempt + 1)
            except aiohttp.ClientError as e:
                log.warning("Client error (attempt %d): %s", attempt + 1, e)
            if attempt < 3:
                await asyncio.sleep(2**attempt)
        self._fails += 1
        if self._fails >= 10:
            self._open_until = time.time() + 60
            log.error("Circuit breaker OPEN after %d failures", self._fails)
        return None

    async def history(
        self, start: int, end: int, kind: str = "day"
    ) -> Optional[List[Dict]]:
        h = await self._headers()
        if not h or not self.sn:
            return None
        try:
            async with self.s.post(
                f"{self.base}/device/history",
                json={
                    "deviceSn": self.sn,
                    "granularity": 1,
                    "startAt": datetime.fromtimestamp(start, tz=timezone.utc).strftime(
                        "%Y-%m-%d"
                    ),
                    "endAt": datetime.fromtimestamp(end, tz=timezone.utc).strftime(
                        "%Y-%m-%d"
                    ),
                },
                headers=h,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as r:
                d = await r.json()
                if d.get("code") == "1000000":
                    raw_list = d.get("dataList", [])
                    out = []
                    for item in raw_list:
                        flat = {"sn": self.sn, "time": item.get("time", "")}
                        for kv in item.get("itemList", []):
                            flat[kv.get("key")] = kv.get("value")
                        out.append(flat)
                    return out
                return None
        except Exception as e:
            log.error("history error: %s", e)
            return None


# ---------------------------------------------------------------------------
# Payload normaliser
# ---------------------------------------------------------------------------
_FIELD_MAP = {
    "pv1V": "pv1_voltage",
    "pv1I": "pv1_current",
    "pv1P": "pv1_power",
    "pv2V": "pv2_voltage",
    "pv2I": "pv2_current",
    "pv2P": "pv2_power",
    "gridV_R": "grid_voltage_r",
    "gridV_S": "grid_voltage_s",
    "gridV_T": "grid_voltage_t",
    "gridI_R": "grid_current_r",
    "gridI_S": "grid_current_s",
    "gridI_T": "grid_current_t",
    "gridFreq": "grid_frequency",
    "gridPToGrid": "grid_export_power",
    "gridPFromGrid": "grid_import_power",
    "batV": "battery_voltage",
    "batI": "battery_current",
    "batSOC": "battery_soc",
    "batP": "battery_power",
    "batChargeSt": "battery_charge_status",
    "loadP": "load_power",
    "invP": "inverter_power",
    "invTemp": "inverter_temperature",
    "invStatus": "inverter_status",
    "workMode": "working_mode",
    "eDay": "daily_production",
    "eTotal": "total_production",
    "eDayToGrid": "daily_grid_export",
    "eTotalToGrid": "total_grid_export",
    "eDayFromGrid": "daily_grid_import",
    "eTotalFromGrid": "total_grid_import",
    "eDayLoad": "daily_load_consumption",
    "eTotalLoad": "total_load_consumption",
    "faultCode": "fault_code",
    "warningCode": "warning_code",
}

_NUMERIC = {
    "pv1_voltage",
    "pv1_current",
    "pv1_power",
    "pv2_voltage",
    "pv2_current",
    "pv2_power",
    "grid_voltage_r",
    "grid_voltage_s",
    "grid_voltage_t",
    "grid_current_r",
    "grid_current_s",
    "grid_current_t",
    "grid_frequency",
    "grid_import_power",
    "grid_export_power",
    "load_power",
    "battery_voltage",
    "battery_current",
    "battery_soc",
    "battery_power",
    "inverter_power",
    "inverter_temperature",
    "daily_production",
    "total_production",
    "daily_grid_export",
    "total_grid_export",
    "daily_grid_import",
    "total_grid_import",
    "daily_load_consumption",
    "total_load_consumption",
    "daily_savings",
    "total_savings",
}


def _float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def normalise(raw: Dict[str, Any], sn: str, import_tariff: Optional[float] = None) -> Dict[str, Any]:
    n: Dict[str, Any] = {
        "time": datetime.now(timezone.utc).isoformat(),
        "inverter_sn": sn,
    }
    for src, dst in _FIELD_MAP.items():
        if src in raw:
            n[dst] = raw[src]
    if "grid_export_power" not in n and "gridP" in raw:
        gp = _float(raw["gridP"]) or 0
        n["grid_export_power" if gp >= 0 else "grid_import_power"] = abs(gp)
    for f in _NUMERIC:
        if f in n:
            n[f] = _float(n[f])
    exp = _float(n.get("daily_grid_export")) or 0
    self_use = (_float(n.get("daily_production")) or 0) - exp
    effective_import = import_tariff if import_tariff is not None else Cfg.GRID_IMPORT_TARIFF
    n["daily_savings"] = round(
        exp * Cfg.FEED_IN_TARIFF + self_use * effective_import, 4
    )
    t_exp = _float(n.get("total_grid_export")) or 0
    t_self = (_float(n.get("total_production")) or 0) - t_exp
    n["total_savings"] = round(
        t_exp * Cfg.FEED_IN_TARIFF + t_self * effective_import, 2
    )
    return n


# ---------------------------------------------------------------------------
# Outage buffer (Redis list)
# ---------------------------------------------------------------------------
class Buffer:
    KEY = "deye:buffer:telemetry"

    def __init__(self, rd: aioredis.Redis):
        self.rd = rd

    async def push(self, item: Dict):
        try:
            p = self.rd.pipeline()
            p.rpush(self.KEY, json.dumps(item))
            p.ltrim(self.KEY, -Cfg.BUFFER_MAX, -1)
            await p.execute()
        except Exception as e:
            log.error("buffer push: %s", e)

    async def drain(self) -> List[Dict]:
        items: List[Dict] = []
        try:
            while True:
                v = await self.rd.lpop(self.KEY)
                if v is None:
                    break
                items.append(json.loads(v))
        except Exception as e:
            log.error("buffer drain: %s", e)
        return items

    async def size(self) -> int:
        try:
            return await self.rd.llen(self.KEY)
        except Exception:
            return 0


# ---------------------------------------------------------------------------
# Alert evaluator
# ---------------------------------------------------------------------------
class AlertEval:
    def __init__(self, rd: aioredis.Redis, pool: asyncpg.Pool):
        self.rd = rd
        self.pool = pool

    async def check(self, t: Dict):
        sn = t.get("inverter_sn", "?")
        alerts: List[Dict] = []

        temp = _float(t.get("inverter_temperature"))
        if temp is not None and temp > Cfg.ALERT_TEMP_HI:
            alerts.append(
                dict(
                    type="high_temperature",
                    severity="warning" if temp < Cfg.ALERT_TEMP_HI + 10 else "critical",
                    message=f"Inverter temperature {temp}°C exceeds {Cfg.ALERT_TEMP_HI}°C",
                    value=temp,
                    threshold=Cfg.ALERT_TEMP_HI,
                )
            )

        for phase, fld in [
            ("R", "grid_voltage_r"),
            ("S", "grid_voltage_s"),
            ("T", "grid_voltage_t"),
        ]:
            v = _float(t.get(fld))
            if v is not None:
                if v < Cfg.ALERT_V_LO:
                    alerts.append(
                        dict(
                            type="low_voltage",
                            severity="critical",
                            message=f"Phase {phase} voltage {v}V < {Cfg.ALERT_V_LO}V",
                            value=v,
                            threshold=Cfg.ALERT_V_LO,
                        )
                    )
                elif v > Cfg.ALERT_V_HI:
                    alerts.append(
                        dict(
                            type="high_voltage",
                            severity="critical",
                            message=f"Phase {phase} voltage {v}V > {Cfg.ALERT_V_HI}V",
                            value=v,
                            threshold=Cfg.ALERT_V_HI,
                        )
                    )

        freq = _float(t.get("grid_frequency"))
        if freq is not None:
            if freq < Cfg.ALERT_F_LO:
                alerts.append(
                    dict(
                        type="low_frequency",
                        severity="critical",
                        message=f"Frequency {freq}Hz < {Cfg.ALERT_F_LO}Hz",
                        value=freq,
                        threshold=Cfg.ALERT_F_LO,
                    )
                )
            elif freq > Cfg.ALERT_F_HI:
                alerts.append(
                    dict(
                        type="high_frequency",
                        severity="critical",
                        message=f"Frequency {freq}Hz > {Cfg.ALERT_F_HI}Hz",
                        value=freq,
                        threshold=Cfg.ALERT_F_HI,
                    )
                )

        soc = _float(t.get("battery_soc"))
        if soc is not None and soc < Cfg.ALERT_SOC_LO:
            alerts.append(
                dict(
                    type="low_battery_soc",
                    severity="warning",
                    message=f"Battery SOC {soc}% < {Cfg.ALERT_SOC_LO}%",
                    value=soc,
                    threshold=Cfg.ALERT_SOC_LO,
                )
            )

        fc = t.get("fault_code")
        if fc and int(fc) != 0:
            alerts.append(
                dict(
                    type="fault_code",
                    severity="critical",
                    message=f"Fault code active: {fc}",
                    value=int(fc),
                    threshold=0,
                )
            )
        wc = t.get("warning_code")
        if wc and int(wc) != 0:
            alerts.append(
                dict(
                    type="warning_code",
                    severity="warning",
                    message=f"Warning code active: {wc}",
                    value=int(wc),
                    threshold=0,
                )
            )

        for a in alerts:
            try:
                async with self.pool.acquire() as c:
                    await c.execute(
                        "INSERT INTO alerts (inverter_sn,alert_type,severity,message,value,threshold) VALUES ($1,$2,$3,$4,$5,$6)",
                        sn,
                        a["type"],
                        a["severity"],
                        a["message"],
                        a.get("value"),
                        a.get("threshold"),
                    )
            except Exception as e:
                log.error("persist alert: %s", e)
            await self.rd.publish(
                "solar:alerts",
                json.dumps({"inverter_sn": sn, **a, "timestamp": t["time"]}),
            )


# ---------------------------------------------------------------------------
# Main collector orchestrator
# ---------------------------------------------------------------------------
class Collector:
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.rd: Optional[aioredis.Redis] = None
        self.db: Optional[asyncpg.Pool] = None
        self.auth: Optional[DeyeAuth] = None
        self.client: Optional[DeyeClient] = None
        self.buf: Optional[Buffer] = None
        self.ae: Optional[AlertEval] = None
        self.running = False
        self.count = 0
        self.errors = 0

    # -- lifecycle ----------------------------------------------------------
    async def start(self):
        log.info("Booting collector…")
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(limit=10, ttl_dns_cache=300),
            headers={
                "User-Agent": "SolarPlatform/1.0",
                "Content-Type": "application/json",
            },
        )
        self.rd = aioredis.from_url(
            Cfg.REDIS_URL, decode_responses=True, max_connections=5
        )
        await self.rd.ping()
        self.db = await asyncpg.create_pool(Cfg.DATABASE_URL, min_size=2, max_size=10)
        async with self.db.acquire() as c:
            await c.fetchval("SELECT 1")
        self.auth = DeyeAuth(self.session)
        await self.auth.login()
        self.client = DeyeClient(self.session, self.auth)
        self.buf = Buffer(self.rd)
        self.ae = AlertEval(self.rd, self.db)
        await self._init_billing()
        await self.rd.set("collector:status", "running")
        log.info("Collector ready")

    async def stop(self):
        self.running = False
        log.info("Shutting down…")
        if self.buf:
            await self._flush()
        await self.rd.set("collector:status", "stopped")
        if self.db:
            await self.db.close()
        if self.rd:
            await self.rd.close()
        if self.session:
            await self.session.close()
        log.info("Stopped")

    # -- collection cycle ---------------------------------------------------
    async def _store(self, t: Dict):
        try:
            async with self.db.acquire() as c:
                await c.execute(
                    """INSERT INTO telemetry (
                        time,inverter_sn,
                        pv1_voltage,pv1_current,pv1_power,pv2_voltage,pv2_current,pv2_power,
                        grid_voltage_r,grid_voltage_s,grid_voltage_t,
                        grid_current_r,grid_current_s,grid_current_t,
                        grid_frequency,grid_import_power,grid_export_power,
                        load_power,battery_voltage,battery_current,battery_soc,battery_power,battery_charge_status,
                        inverter_power,inverter_temperature,inverter_status,working_mode,
                        daily_production,total_production,daily_grid_export,total_grid_export,
                        daily_grid_import,total_grid_import,daily_load_consumption,total_load_consumption,
                        fault_code,warning_code,daily_savings,total_savings
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39)""",
                    datetime.fromisoformat(t["time"])
                    if isinstance(t["time"], str)
                    else t["time"],
                    t["inverter_sn"],
                    t.get("pv1_voltage"),
                    t.get("pv1_current"),
                    t.get("pv1_power"),
                    t.get("pv2_voltage"),
                    t.get("pv2_current"),
                    t.get("pv2_power"),
                    t.get("grid_voltage_r"),
                    t.get("grid_voltage_s"),
                    t.get("grid_voltage_t"),
                    t.get("grid_current_r"),
                    t.get("grid_current_s"),
                    t.get("grid_current_t"),
                    t.get("grid_frequency"),
                    t.get("grid_import_power"),
                    t.get("grid_export_power"),
                    t.get("load_power"),
                    t.get("battery_voltage"),
                    t.get("battery_current"),
                    t.get("battery_soc"),
                    t.get("battery_power"),
                    t.get("battery_charge_status"),
                    t.get("inverter_power"),
                    t.get("inverter_temperature"),
                    t.get("inverter_status"),
                    t.get("working_mode"),
                    t.get("daily_production"),
                    t.get("total_production"),
                    t.get("daily_grid_export"),
                    t.get("total_grid_export"),
                    t.get("daily_grid_import"),
                    t.get("total_grid_import"),
                    t.get("daily_load_consumption"),
                    t.get("total_load_consumption"),
                    t.get("fault_code"),
                    t.get("warning_code"),
                    t.get("daily_savings"),
                    t.get("total_savings"),
                )
        except Exception as e:
            log.error("store: %s", e)
            await self.buf.push(t)

    async def _init_billing(self):
        if not await self.rd.exists("consumption:billing:snapshot"):
            await self.rd.set("consumption:billing:snapshot", "0")
            await self.rd.set("consumption:billing:cycle_start", datetime.now(timezone.utc).isoformat())

    async def _billing_consumption_kwh(self, total_load: Optional[float]) -> float:
        if total_load is None:
            return 0.0
        snapshot = float(await self.rd.get("consumption:billing:snapshot") or "0")
        if snapshot <= 0:
            await self.rd.set("consumption:billing:snapshot", str(total_load))
            await self.rd.set("consumption:billing:cycle_start", datetime.now(timezone.utc).isoformat())
            return 0.0
        cycle_start_str = await self.rd.get("consumption:billing:cycle_start") or ""
        if cycle_start_str:
            try:
                cycle_start = datetime.fromisoformat(cycle_start_str)
                if (datetime.now(timezone.utc) - cycle_start).days >= Cfg.BILLING_DAYS:
                    await self.rd.set("consumption:billing:snapshot", str(total_load))
                    await self.rd.set("consumption:billing:cycle_start", datetime.now(timezone.utc).isoformat())
                    return 0.0
            except ValueError:
                pass
        return max(0, total_load - snapshot)

    async def _flush(self):
        items = await self.buf.drain()
        if not items:
            return
        log.info("Flushing %d buffered items", len(items))
        ok = 0
        for i in items:
            if "error" in i:
                continue
            try:
                await self._store(i)
                ok += 1
            except Exception:
                pass
        log.info("Flushed %d/%d", ok, len(items))

    async def _update_inv(self, sn: str, raw: Dict):
        try:
            async with self.db.acquire() as c:
                await c.execute(
                    """INSERT INTO inverters (serial_number,model,firmware_version,last_seen,status)
                       VALUES ($1,$2,$3,NOW(),'online')
                       ON CONFLICT (serial_number) DO UPDATE SET
                           model=COALESCE($2,inverters.model),
                           firmware_version=COALESCE($3,inverters.firmware_version),
                           last_seen=NOW(),status='online'""",
                    sn,
                    raw.get("model"),
                    raw.get("softVer"),
                )
        except Exception as e:
            log.error("update inverter: %s", e)

    async def tick(self):
        raw = await self.client.realtime()
        if not raw:
            self.errors += 1
            log.warning("Collection failed (errors=%d)", self.errors)
            return
        self.errors = 0
        sn = raw.get("sn", Cfg.INVERTER_SN or "unknown")
        total_load = _float(raw.get("eTotalLoad"))
        billing_kwh = await self._billing_consumption_kwh(total_load)
        tariff = Cfg.effective_import_tariff(billing_kwh)
        t = normalise(raw, sn, import_tariff=tariff)
        await self.rd.set(f"telemetry:latest:{sn}", json.dumps(t), ex=120)
        await self.rd.publish(f"telemetry:realtime:{sn}", json.dumps(t))
        await self._store(t)
        await self.ae.check(t)
        await self._update_inv(sn, raw)
        self.count += 1
        pv = (t.get("pv1_power") or 0) + (t.get("pv2_power") or 0)
        gexp = t.get("grid_export_power") or 0
        gimp = t.get("grid_import_power") or 0
        grid = gexp - gimp
        load = t.get("load_power") or 0
        day = t.get("daily_production") or 0
        temp = t.get("inverter_temperature")
        log.info(
            "PV=%.0fW Grid=%+.0fW Load=%.0fW Today=%.1fkWh Temp=%s",
            pv, grid, load, day,
            f"{temp}°C" if temp else "N/A",
        )
        await self.rd.set("collector:last_collection", t["time"])
        await self.rd.set("collector:collection_count", str(self.count))
        await self.rd.set("collector:error_count", str(self.errors))
        await self.rd.set("collector:billing_kwh", str(billing_kwh))
        await self.rd.set("collector:tariff_rate", str(tariff))

    async def _sync_history(self):
        log.info("History sync…")
        now = datetime.now(timezone.utc)
        data = await self.client.history(
            int((now - timedelta(days=1)).timestamp()), int(now.timestamp()), "day"
        )
        if data:
            log.info("History: %d records", len(data))
            for r in data:
                total_h = _float(r.get("eTotalLoad"))
                billing_h = await self._billing_consumption_kwh(total_h)
                tariff_h = Cfg.effective_import_tariff(billing_h)
                t = normalise(r, Cfg.INVERTER_SN or r.get("sn", "unknown"), import_tariff=tariff_h)
                if "time" in r and r["time"]:
                    try:
                        t["time"] = datetime.fromtimestamp(
                            int(r["time"]), tz=timezone.utc
                        )
                    except (ValueError, TypeError):
                        dt = (
                            datetime.fromisoformat(r["time"])
                            if isinstance(r["time"], str)
                            else r["time"]
                        )
                        t["time"] = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
                try:
                    await self._store(t)
                except Exception:
                    pass

    async def _check_offline(self):
        try:
            async with self.db.acquire() as c:
                rows = await c.fetch(
                    """UPDATE inverters SET status='offline'
                       WHERE last_seen < NOW() - ($1 || ' seconds')::INTERVAL AND status='online'
                       RETURNING serial_number""",
                    str(Cfg.ALERT_OFFLINE_S),
                )
                for r in rows:
                    msg = (
                        f"Inverter {r['serial_number']} offline >{Cfg.ALERT_OFFLINE_S}s"
                    )
                    await c.execute(
                        "INSERT INTO alerts (inverter_sn,alert_type,severity,message) VALUES ($1,'inverter_offline','critical',$2)",
                        r["serial_number"],
                        msg,
                    )
                    await self.rd.publish(
                        "solar:alerts",
                        json.dumps(
                            {
                                "inverter_sn": r["serial_number"],
                                "type": "inverter_offline",
                                "severity": "critical",
                                "message": msg,
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                        ),
                    )
        except Exception as e:
            log.error("offline check: %s", e)

    # -- main loop ----------------------------------------------------------
    async def run(self):
        self.running = True
        last_hist = 0.0
        offline_tick = 0
        while self.running:
            # Check for remote stop command via Redis
            try:
                cmd = await self.rd.get("collector:command")
                if cmd == "stop":
                    await self.rd.delete("collector:command")
                    log.info("Received stop command via Redis")
                    break
                if cmd == "restart":
                    await self.rd.delete("collector:command")
                    log.info("Received restart command — re-authenticating")
                    await self.auth.login()
            except Exception:
                pass

            try:
                await self.tick()
            except Exception as e:
                log.error("tick error: %s", e)

            now = time.time()
            if now - last_hist > Cfg.HISTORY_INTERVAL:
                await self._sync_history()
                last_hist = now
            if now - offline_tick > 30:
                await self._check_offline()
                offline_tick = now

            await asyncio.sleep(Cfg.INTERVAL)


# ---------------------------------------------------------------------------
# Health-check HTTP micro-server (port 8090)
# ---------------------------------------------------------------------------
_collector = Collector()


async def _health(req: web.Request) -> web.Response:
    return web.json_response(
        {
            "status": "running" if _collector.running else "stopped",
            "collections": _collector.count,
            "errors": _collector.errors,
            "buffer": await _collector.buf.size() if _collector.buf else 0,
        }
    )


async def _start_health():
    app = web.Application()
    app.router.add_get("/health", _health)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", 8090).start()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    await _collector.start()
    await _start_health()
    loop = asyncio.get_event_loop()
    done = loop.create_future()

    def _sig():
        if not done.done():
            done.set_result(None)

    for s in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(s, _sig)

    try:
        await _collector.run()
    except asyncio.CancelledError:
        pass
    finally:
        await _collector.stop()


if __name__ == "__main__":
    asyncio.run(main())
