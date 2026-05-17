-- =============================================
-- Supabase-compatible schema (no TimescaleDB)
-- =============================================

-- =============================================
-- Real-time telemetry table
-- =============================================
CREATE TABLE IF NOT EXISTS telemetry (
    time TIMESTAMPTZ NOT NULL,
    inverter_sn TEXT NOT NULL,

    -- PV Input (dual MPPT)
    pv1_voltage DOUBLE PRECISION,
    pv1_current DOUBLE PRECISION,
    pv1_power DOUBLE PRECISION,
    pv2_voltage DOUBLE PRECISION,
    pv2_current DOUBLE PRECISION,
    pv2_power DOUBLE PRECISION,

    -- Grid (three-phase)
    grid_voltage_r DOUBLE PRECISION,
    grid_voltage_s DOUBLE PRECISION,
    grid_voltage_t DOUBLE PRECISION,
    grid_current_r DOUBLE PRECISION,
    grid_current_s DOUBLE PRECISION,
    grid_current_t DOUBLE PRECISION,
    grid_frequency DOUBLE PRECISION,
    grid_import_power DOUBLE PRECISION,
    grid_export_power DOUBLE PRECISION,

    -- Load
    load_power DOUBLE PRECISION,

    -- Battery (hybrid inverter)
    battery_voltage DOUBLE PRECISION,
    battery_current DOUBLE PRECISION,
    battery_soc DOUBLE PRECISION,
    battery_power DOUBLE PRECISION,
    battery_charge_status SMALLINT,

    -- Inverter state
    inverter_power DOUBLE PRECISION,
    inverter_temperature DOUBLE PRECISION,
    inverter_status SMALLINT,
    working_mode SMALLINT,

    -- Energy counters (kWh)
    daily_production DOUBLE PRECISION,
    total_production DOUBLE PRECISION,
    daily_grid_export DOUBLE PRECISION,
    total_grid_export DOUBLE PRECISION,
    daily_grid_import DOUBLE PRECISION,
    total_grid_import DOUBLE PRECISION,
    daily_load_consumption DOUBLE PRECISION,
    total_load_consumption DOUBLE PRECISION,

    -- Fault / warning bitfields
    fault_code INTEGER,
    warning_code INTEGER,

    -- Derived financial (currency units)
    daily_savings DOUBLE PRECISION,
    total_savings DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_telemetry_sn_time
    ON telemetry (inverter_sn, time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_time
    ON telemetry (time DESC);

-- =============================================
-- Daily summaries — regular materialized view
-- Refreshed via cron: REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_daily;
-- =============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_daily AS
SELECT
    date_trunc('day', time)                    AS day,
    inverter_sn,
    AVG(pv1_power)                              AS avg_pv1_power,
    MAX(pv1_power)                              AS peak_pv1_power,
    AVG(pv2_power)                              AS avg_pv2_power,
    MAX(pv2_power)                              AS peak_pv2_power,
    AVG(inverter_power)                         AS avg_inverter_power,
    MAX(inverter_power)                         AS peak_inverter_power,
    MAX(inverter_temperature)                   AS max_temperature,
    AVG(inverter_temperature)                   AS avg_temperature,
    AVG(grid_frequency)                         AS avg_frequency,
    SUM(COALESCE(grid_export_power, 0)) * 10.0 / 3600.0
                                                  AS total_grid_export_wh,
    SUM(COALESCE(grid_import_power, 0)) * 10.0 / 3600.0
                                                  AS total_grid_import_wh,
    SUM(COALESCE(load_power, 0)) * 10.0 / 3600.0 AS total_load_wh,
    MAX(daily_production)                         AS daily_production_kwh,
    MAX(daily_savings)                            AS daily_savings,
    COUNT(*)                                      AS sample_count
FROM telemetry
GROUP BY day, inverter_sn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_daily_day_sn
    ON telemetry_daily (day, inverter_sn);

-- =============================================
-- Monthly summaries — regular materialized view
-- Refreshed via cron: REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_monthly;
-- =============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_monthly AS
SELECT
    date_trunc('month', time)                   AS month,
    inverter_sn,
    AVG(inverter_power)                          AS avg_inverter_power,
    MAX(inverter_power)                          AS peak_inverter_power,
    MAX(inverter_temperature)                    AS max_temperature,
    AVG(inverter_temperature)                    AS avg_temperature,
    SUM(COALESCE(grid_export_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                  AS total_grid_export_kwh,
    SUM(COALESCE(grid_import_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                  AS total_grid_import_kwh,
    SUM(COALESCE(load_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                  AS total_load_kwh,
    MAX(total_production)                         AS total_production_kwh,
    MAX(total_savings)                            AS total_savings,
    COUNT(*)                                      AS sample_count
FROM telemetry
GROUP BY month, inverter_sn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_monthly_month_sn
    ON telemetry_monthly (month, inverter_sn);

-- =============================================
-- Monthly deltas view
-- =============================================
DROP MATERIALIZED VIEW IF EXISTS telemetry_monthly_deltas;

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_monthly_deltas AS
SELECT
    m.month,
    m.inverter_sn,
    COALESCE(
        m.total_production_kwh - LAG(m.total_production_kwh) OVER (PARTITION BY m.inverter_sn ORDER BY m.month),
        0
    ) AS monthly_production_kwh,
    COALESCE(
        m.total_savings - LAG(m.total_savings) OVER (PARTITION BY m.inverter_sn ORDER BY m.month),
        0
    ) AS monthly_savings,
    m.total_grid_export_kwh,
    m.total_grid_import_kwh,
    m.total_load_kwh,
    m.avg_inverter_power,
    m.peak_inverter_power,
    m.max_temperature,
    m.sample_count
FROM telemetry_monthly m;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_deltas_month_sn
    ON telemetry_monthly_deltas (month, inverter_sn);

-- =============================================
-- Alerts table
-- =============================================
CREATE TABLE IF NOT EXISTS alerts (
    id            BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    inverter_sn   TEXT NOT NULL,
    alert_type    TEXT NOT NULL,
    severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    message       TEXT NOT NULL,
    value         DOUBLE PRECISION,
    threshold     DOUBLE PRECISION,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_sn_time
    ON alerts (inverter_sn, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved
    ON alerts (acknowledged) WHERE acknowledged = FALSE;

-- =============================================
-- System configuration key-value store
-- =============================================
CREATE TABLE IF NOT EXISTS system_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT DEFAULT 'system'
);

-- =============================================
-- Inverter registry
-- =============================================
CREATE TABLE IF NOT EXISTS inverters (
    serial_number    TEXT PRIMARY KEY,
    model            TEXT,
    rated_power      DOUBLE PRECISION,
    firmware_version TEXT,
    registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen        TIMESTAMPTZ,
    status           TEXT DEFAULT 'unknown'
);

-- =============================================
-- Billing cycles table
-- =============================================
CREATE TABLE IF NOT EXISTS billing_cycles (
    cycle_start TIMESTAMPTZ PRIMARY KEY,
    cycle_end TIMESTAMPTZ,
    total_production_kwh FLOAT DEFAULT 0,
    total_savings FLOAT DEFAULT 0,
    total_grid_export_kwh FLOAT DEFAULT 0,
    total_grid_import_kwh FLOAT DEFAULT 0,
    total_load_kwh FLOAT DEFAULT 0,
    avg_daily_production FLOAT DEFAULT 0,
    avg_daily_savings FLOAT DEFAULT 0,
    day_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_start
    ON billing_cycles (cycle_start DESC);

-- =============================================
-- Billing reports table
-- =============================================
CREATE TABLE IF NOT EXISTS billing_reports (
    id              BIGSERIAL PRIMARY KEY,
    cycle_start     TIMESTAMPTZ NOT NULL,
    cycle_end       TIMESTAMPTZ NOT NULL,
    total_production_kwh FLOAT DEFAULT 0,
    total_savings FLOAT DEFAULT 0,
    total_grid_export_kwh FLOAT DEFAULT 0,
    total_grid_import_kwh FLOAT DEFAULT 0,
    total_load_kwh FLOAT DEFAULT 0,
    avg_daily_production FLOAT DEFAULT 0,
    avg_daily_savings FLOAT DEFAULT 0,
    day_count INT DEFAULT 0,
    finalized_at    TIMESTAMPTZ DEFAULT NOW(),
    finalized_by    TEXT DEFAULT 'user',
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_reports_start
    ON billing_reports (cycle_start DESC);

CREATE INDEX IF NOT EXISTS idx_billing_reports_end
    ON billing_reports (cycle_end DESC);

-- =============================================
-- Seed default configuration
-- =============================================
INSERT INTO system_config (key, value) VALUES
    ('feed_in_tariff',     '3.50'),
    ('grid_import_tariff', '6.00'),
    ('currency',           'INR'),
    ('collector_status',   'stopped'),
    ('last_collection',    ''),
    ('deye_email',         ''),
    ('deye_app_secret',    ''),
    ('deye_password_enc',  ''),
    ('deye_inverter_sn',   '')
ON CONFLICT (key) DO NOTHING;
