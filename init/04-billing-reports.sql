-- =============================================
-- Billing reports table — stores finalized
-- billing cycle data as historical reports
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
