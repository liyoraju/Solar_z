-- =============================================
-- Telemetry gap tracking & backfill
-- =============================================
-- Detects gaps in telemetry samples caused by WiFi/power outages
-- and fills daily summaries using total_production (eTotal) deltas.

-- Stores backfilled daily values for calendar days with missing samples
CREATE TABLE IF NOT EXISTS telemetry_daily_gaps (
    day DATE NOT NULL,
    inverter_sn TEXT NOT NULL,
    daily_production_kwh DOUBLE PRECISION DEFAULT 0,
    daily_savings DOUBLE PRECISION DEFAULT 0,
    total_grid_export_wh DOUBLE PRECISION DEFAULT 0,
    total_grid_import_wh DOUBLE PRECISION DEFAULT 0,
    total_load_wh DOUBLE PRECISION DEFAULT 0,
    sample_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (day, inverter_sn)
);

-- Audit log of every detected gap with metadata
CREATE TABLE IF NOT EXISTS telemetry_gaps_audit (
    id SERIAL PRIMARY KEY,
    gap_start TIMESTAMPTZ NOT NULL,
    gap_end TIMESTAMPTZ NOT NULL,
    kwh_total_before DOUBLE PRECISION,
    kwh_total_after DOUBLE PRECISION,
    kwh_missed DOUBLE PRECISION NOT NULL,
    day_count INT DEFAULT 0,
    filled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gaps_audit_created
    ON telemetry_gaps_audit (created_at DESC);
