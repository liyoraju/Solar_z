-- =============================================
-- Gap alert badges for today & cycle KPIs
-- =============================================
-- Tracks individual gap events detected by the value-based method
-- (lifetime_total_delta != daily_production_delta) for display
-- as badges on the today total KPI and monthly cycle cards.

CREATE TABLE IF NOT EXISTS telemetry_gap_alerts (
    id SERIAL PRIMARY KEY,
    inverter_sn TEXT NOT NULL,
    gap_start TIMESTAMPTZ NOT NULL,
    gap_end TIMESTAMPTZ NOT NULL,
    kwh_missed DOUBLE PRECISION NOT NULL,
    total_before DOUBLE PRECISION,
    total_after DOUBLE PRECISION,
    daily_before DOUBLE PRECISION,
    daily_after DOUBLE PRECISION,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gap_alerts_status
    ON telemetry_gap_alerts (status);
CREATE INDEX IF NOT EXISTS idx_gap_alerts_created
    ON telemetry_gap_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gap_alerts_gap_start
    ON telemetry_gap_alerts (gap_start);
