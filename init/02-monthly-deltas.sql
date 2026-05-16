-- =============================================
-- Monthly deltas view — computes actual monthly
-- production/savings from cumulative counters
-- Uses a regular materialized view (not continuous
-- aggregate) since window functions aren't supported
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

-- Initial refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_monthly_deltas;
