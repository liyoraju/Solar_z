"""
Historical Backfill Script
===========================
Fetches daily aggregates from Deye Cloud API and inserts into telemetry table.

Usage (inside collector container):
    docker compose exec collector python /app/scripts/backfill_history.py

Or with custom date range:
    BACKFILL_START=2026-04-29 BACKFILL_END=2026-05-16 docker compose exec collector python /app/scripts/backfill_history.py
"""

import asyncio
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import aiohttp
import asyncpg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("backfill")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
API_BASE = os.getenv("DEYE_API_BASE_URL", "https://india-developer.deyecloud.com/v1.0")
APP_ID = os.getenv("DEYE_APP_ID", "")
APP_SECRET = os.getenv("DEYE_APP_SECRET", "")
EMAIL = os.getenv("DEYE_EMAIL", "")
PASSWORD = os.getenv("DEYE_PASSWORD", "")
INVERTER_SN = os.getenv("DEYE_INVERTER_SN", "")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://solar:solar_secure_2024@postgres:5432/solar_platform",
)
FEED_IN_TARIFF = float(os.getenv("FEED_IN_TARIFF", "3.50"))
GRID_IMPORT_TARIFF = float(os.getenv("GRID_IMPORT_TARIFF", "6.00"))
TARIFF_MODE = os.getenv("TARIFF_MODE", "telescopic")
TARIFF_SLABS = os.getenv("TARIFF_SLABS", "50:3.35,100:4.25,150:5.35,200:7.20,250:8.50")
TARIFF_NT = os.getenv("TARIFF_NON_TELESCOPIC", "300:6.75,350:7.60,400:7.95,500:8.25,999999:9.20")

BACKFILL_START = os.getenv("BACKFILL_START", "2026-04-29")
BACKFILL_END = os.getenv("BACKFILL_END", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

# ---------------------------------------------------------------------------
# Key mappings (same as collector)
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
    "pv1_voltage", "pv1_current", "pv1_power",
    "pv2_voltage", "pv2_current", "pv2_power",
    "grid_voltage_r", "grid_voltage_s", "grid_voltage_t",
    "grid_current_r", "grid_current_s", "grid_current_t",
    "grid_frequency", "grid_import_power", "grid_export_power",
    "load_power", "battery_voltage", "battery_current",
    "battery_soc", "battery_power", "inverter_power",
    "inverter_temperature", "daily_production", "total_production",
    "daily_grid_export", "total_grid_export",
    "daily_grid_import", "total_grid_import",
    "daily_load_consumption", "total_load_consumption",
    "daily_savings", "total_savings",
}


def _float(v):
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _parse_slabs(s):
    slabs = []
    for part in s.split(","):
        upper, rate = part.split(":")
        slabs.append((int(upper), float(rate)))
    slabs.sort(key=lambda x: x[0])
    return slabs


def effective_tariff(total_kwh):
    raw = TARIFF_NT if TARIFF_MODE == "non_telescopic" else TARIFF_SLABS
    slabs = _parse_slabs(raw)
    if not slabs:
        return GRID_IMPORT_TARIFF
    prev = 0
    for upper, rate in slabs:
        if prev < total_kwh <= upper:
            return rate
        prev = upper
    return slabs[-1][1]


def normalise(raw: Dict[str, Any], sn: str, day_str: str) -> Dict[str, Any]:
    """Normalize a single day's history data into a telemetry row.
    
    Granularity=2 returns pre-aggregated daily totals:
    - Production (kWh)
    - GridFeed-in (kWh)
    - Consumption (kWh)
    - ElectricityPurchasing (kWh)
    """
    dt = datetime.strptime(day_str, "%Y-%m-%d").replace(
        hour=12, minute=0, second=0, tzinfo=timezone.utc
    )
    
    daily_prod = _float(raw.get("Production"))
    daily_export = _float(raw.get("GridFeed-in"))
    daily_import = _float(raw.get("ElectricityPurchasing"))
    daily_load = _float(raw.get("Consumption"))
    
    tariff = effective_tariff(daily_load or 0)
    self_use = (daily_prod or 0) - (daily_export or 0)
    daily_savings = round((daily_export or 0) * FEED_IN_TARIFF + self_use * tariff, 4)
    
    n: Dict[str, Any] = {
        "time": dt,
        "inverter_sn": sn,
        "daily_production": daily_prod,
        "daily_grid_export": daily_export,
        "daily_grid_import": daily_import,
        "daily_load_consumption": daily_load,
        "daily_savings": daily_savings,
    }
    return n


# ---------------------------------------------------------------------------
# Deye API
# ---------------------------------------------------------------------------
async def authenticate(session: aiohttp.ClientSession) -> Optional[str]:
    pwd_hash = hashlib.sha256(PASSWORD.encode()).hexdigest()
    async with session.post(
        f"{API_BASE}/account/token?appId={APP_ID}",
        json={
            "appSecret": APP_SECRET,
            "email": EMAIL,
            "password": pwd_hash,
            "companyId": "0",
        },
        timeout=aiohttp.ClientTimeout(total=30),
    ) as r:
        d = await r.json()
        if d.get("code") != "1000000":
            log.error("Login failed: %s", d.get("msg"))
            return None
        log.info("Authenticated with Deye cloud")
        return d["accessToken"]


async def fetch_history(
    session: aiohttp.ClientSession, token: str, start: str, end: str
) -> Optional[List[Dict]]:
    async with session.post(
        f"{API_BASE}/device/history",
        json={
            "deviceSn": INVERTER_SN,
            "granularity": 2,
            "startAt": start,
            "endAt": end,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=aiohttp.ClientTimeout(total=30),
    ) as r:
        d = await r.json()
        if d.get("code") != "1000000":
            log.error("History fetch failed: %s", d.get("msg"))
            return None
        raw_list = d.get("dataList", [])
        log.info("Fetched %d daily records from Deye", len(raw_list))
        out = []
        for item in raw_list:
            flat = {"time": item.get("time", "")}
            for kv in item.get("itemList", []):
                k = _V1_KEY_MAP.get(kv.get("key"), kv.get("key"))
                flat[k] = kv.get("value")
            out.append(flat)
        return out


# ---------------------------------------------------------------------------
# Database insert
# ---------------------------------------------------------------------------
async def insert_telemetry(conn, row: Dict) -> str:
    """Insert a telemetry row, skip if already exists. Returns 'inserted', 'skipped', or 'error'."""
    try:
        result = await conn.execute(
            """INSERT INTO telemetry (
                time, inverter_sn,
                pv1_voltage, pv1_current, pv1_power,
                pv2_voltage, pv2_current, pv2_power,
                grid_voltage_r, grid_voltage_s, grid_voltage_t,
                grid_current_r, grid_current_s, grid_current_t,
                grid_frequency, grid_import_power, grid_export_power,
                load_power, battery_voltage, battery_current,
                battery_soc, battery_power, battery_charge_status,
                inverter_power, inverter_temperature,
                inverter_status, working_mode,
                daily_production, total_production,
                daily_grid_export, total_grid_export,
                daily_grid_import, total_grid_import,
                daily_load_consumption, total_load_consumption,
                fault_code, warning_code,
                daily_savings, total_savings
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $14, $15, $16, $17, $18, $19, $20,
                   $21, $22, $23, $24, $25, $26, $27, $28, $29,
                   $30, $31, $32, $33, $34, $35, $36, $37, $38, $39
            WHERE NOT EXISTS (
                SELECT 1 FROM telemetry
                WHERE time = $1 AND inverter_sn = $2
            )""",
            row["time"],
            row["inverter_sn"],
            row.get("pv1_voltage"),
            row.get("pv1_current"),
            row.get("pv1_power"),
            row.get("pv2_voltage"),
            row.get("pv2_current"),
            row.get("pv2_power"),
            row.get("grid_voltage_r"),
            row.get("grid_voltage_s"),
            row.get("grid_voltage_t"),
            row.get("grid_current_r"),
            row.get("grid_current_s"),
            row.get("grid_current_t"),
            row.get("grid_frequency"),
            row.get("grid_import_power"),
            row.get("grid_export_power"),
            row.get("load_power"),
            row.get("battery_voltage"),
            row.get("battery_current"),
            row.get("battery_soc"),
            row.get("battery_power"),
            row.get("battery_charge_status"),
            row.get("inverter_power"),
            row.get("inverter_temperature"),
            row.get("inverter_status"),
            row.get("working_mode"),
            row.get("daily_production"),
            row.get("total_production"),
            row.get("daily_grid_export"),
            row.get("total_grid_export"),
            row.get("daily_grid_import"),
            row.get("total_grid_import"),
            row.get("daily_load_consumption"),
            row.get("total_load_consumption"),
            row.get("fault_code"),
            row.get("warning_code"),
            row.get("daily_savings"),
            row.get("total_savings"),
        )
        # asyncpg returns "INSERT 0 1" or "INSERT 0 0"
        rows_affected = int(result.split()[-1]) if result else 0
        return "inserted" if rows_affected > 0 else "skipped"
    except Exception as e:
        log.error("Insert error for %s: %s", row["time"], e)
        return "error"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main():
    log.info("=" * 60)
    log.info("Deye History Backfill")
    log.info("Range: %s → %s", BACKFILL_START, BACKFILL_END)
    log.info("Inverter: %s", INVERTER_SN)
    log.info("=" * 60)

    if not all([APP_ID, APP_SECRET, EMAIL, PASSWORD, INVERTER_SN]):
        log.error("Missing Deye credentials in .env")
        sys.exit(1)

    async with aiohttp.ClientSession() as session:
        token = await authenticate(session)
        if not token:
            log.error("Authentication failed")
            sys.exit(1)

        data = await fetch_history(session, token, BACKFILL_START, BACKFILL_END)
        if not data:
            log.error("No history data returned")
            sys.exit(1)

    log.info("Connecting to database...")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        inserted = 0
        skipped = 0
        errors = 0
        for raw in data:
            day_str = raw.get("time", "")[:10]
            if not day_str:
                log.warning("Skipping record with no time: %s", raw)
                skipped += 1
                continue
            row = normalise(raw, INVERTER_SN, day_str)
            status = await insert_telemetry(conn, row)
            if status == "inserted":
                inserted += 1
                prod = row.get("daily_production", 0) or 0
                sav = row.get("daily_savings", 0) or 0
                log.info("  + %s: %.1f kWh, %.2f savings", day_str, prod, sav)
            elif status == "skipped":
                skipped += 1
                log.info("  - %s: already exists", day_str)
            else:
                errors += 1
                log.error("  ! %s: insert failed", day_str)

        log.info("=" * 60)
        log.info("Backfill complete!")
        log.info("  Inserted: %d", inserted)
        log.info("  Skipped:  %d", skipped)
        log.info("  Errors:   %d", errors)
        log.info("  Total:    %d", inserted + skipped + errors)
        log.info("=" * 60)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
