-- =============================================
-- Billing cycles table — stores completed cycle
-- summaries with auto-rollover
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

-- Seed initial cycle if none exists (uses earliest data date)
INSERT INTO billing_cycles (cycle_start, cycle_end)
SELECT
    (SELECT MIN(day) FROM telemetry_daily),
    NULL
WHERE NOT EXISTS (SELECT 1 FROM billing_cycles LIMIT 1);
