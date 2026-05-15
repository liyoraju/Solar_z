-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =============================================
-- Real-time telemetry hypertable
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

SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_telemetry_sn_time
    ON telemetry (inverter_sn, time DESC);

-- =============================================
-- Continuous aggregate — daily summaries
-- =============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time)                    AS day,
    inverter_sn,
    AVG(pv1_power)                                 AS avg_pv1_power,
    MAX(pv1_power)                                 AS peak_pv1_power,
    AVG(pv2_power)                                 AS avg_pv2_power,
    MAX(pv2_power)                                 AS peak_pv2_power,
    AVG(inverter_power)                            AS avg_inverter_power,
    MAX(inverter_power)                            AS peak_inverter_power,
    MAX(inverter_temperature)                      AS max_temperature,
    AVG(inverter_temperature)                      AS avg_temperature,
    AVG(grid_frequency)                            AS avg_frequency,
    SUM(COALESCE(grid_export_power, 0)) * 10.0 / 3600.0
                                                   AS total_grid_export_wh,
    SUM(COALESCE(grid_import_power, 0)) * 10.0 / 3600.0
                                                   AS total_grid_import_wh,
    SUM(COALESCE(load_power, 0)) * 10.0 / 3600.0  AS total_load_wh,
    MAX(daily_production)                          AS daily_production_kwh,
    MAX(daily_savings)                             AS daily_savings,
    COUNT(*)                                       AS sample_count
FROM telemetry
GROUP BY day, inverter_sn;

-- =============================================
-- Continuous aggregate — monthly summaries
-- =============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_monthly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 month', time)                   AS month,
    inverter_sn,
    AVG(inverter_power)                            AS avg_inverter_power,
    MAX(inverter_power)                            AS peak_inverter_power,
    MAX(inverter_temperature)                      AS max_temperature,
    AVG(inverter_temperature)                      AS avg_temperature,
    SUM(COALESCE(grid_export_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                   AS total_grid_export_kwh,
    SUM(COALESCE(grid_import_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                   AS total_grid_import_kwh,
    SUM(COALESCE(load_power, 0)) * 10.0 / 3600.0 / 1000.0
                                                   AS total_load_kwh,
    MAX(total_production)                          AS total_production_kwh,
    MAX(total_savings)                             AS total_savings,
    COUNT(*)                                       AS sample_count
FROM telemetry
GROUP BY month, inverter_sn;

-- Refresh policies
SELECT add_continuous_aggregate_policy('telemetry_daily',
    start_offset => INTERVAL '3 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('telemetry_monthly',
    start_offset => INTERVAL '3 months',
    end_offset   => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day');

-- Retention: keep raw data for 2 years
SELECT add_retention_policy('telemetry', INTERVAL '2 years');

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