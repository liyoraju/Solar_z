-- =============================================
-- Neon Diagnostic: Find Totals Discrepancy
-- Run all queries on your Neon database
-- =============================================

-- Query 1: Current cycle start date
SELECT cycle_start AS current_cycle_start
FROM billing_cycles
WHERE cycle_end IS NULL
ORDER BY cycle_start DESC
LIMIT 1;

-- Query 2: Days being summed from telemetry_daily
SELECT
    COUNT(*) AS days_counted,
    MIN(day) AS first_day,
    MAX(day) AS last_day,
    SUM(daily_production_kwh) AS total_prod_kwh,
    SUM(daily_savings) AS total_savings
FROM telemetry_daily
WHERE day >= (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1)
  AND day < CURRENT_DATE;

-- Query 3: Extra production from gap table
SELECT
    COUNT(*) AS gap_days,
    SUM(daily_production_kwh) AS gap_prod_kwh,
    SUM(daily_savings) AS gap_savings
FROM telemetry_daily_gaps
WHERE day >= (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1)
  AND day < CURRENT_DATE;

-- Query 4: Today's live value
SELECT
    daily_production,
    daily_savings,
    daily_grid_export,
    daily_grid_import,
    time AS last_update
FROM telemetry
WHERE time >= CURRENT_DATE
ORDER BY time DESC
LIMIT 1;

-- Query 5: Full breakdown (what the API actually computes)
WITH cycle AS (
    SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1
),
daily_sum AS (
    SELECT
        COALESCE(SUM(daily_production_kwh), 0) AS prod,
        COALESCE(SUM(daily_savings), 0) AS sav
    FROM telemetry_daily
    WHERE day >= (SELECT cycle_start FROM cycle) AND day < CURRENT_DATE
),
gap_sum AS (
    SELECT
        COALESCE(SUM(daily_production_kwh), 0) AS prod,
        COALESCE(SUM(daily_savings), 0) AS sav
    FROM telemetry_daily_gaps
    WHERE day >= (SELECT cycle_start FROM cycle) AND day < CURRENT_DATE
),
today AS (
    SELECT
        COALESCE(daily_production, 0) AS prod,
        COALESCE(daily_savings, 0) AS sav
    FROM telemetry
    WHERE time >= CURRENT_DATE
    ORDER BY time DESC LIMIT 1
)
SELECT
    d.prod + g.prod + t.prod AS total_production_kwh,
    d.sav + g.sav + t.sav AS total_savings,
    d.prod AS from_daily,
    g.prod AS from_gaps,
    t.prod AS from_today,
    d.sav AS savings_daily,
    g.sav AS savings_gaps,
    t.sav AS savings_today
FROM daily_sum d, gap_sum g, today t;

-- Query 6: Check for duplicate days in telemetry_daily
SELECT day, COUNT(*) AS dup_count
FROM telemetry_daily
WHERE day >= (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1)
GROUP BY day
HAVING COUNT(*) > 1
ORDER BY day DESC;

-- Query 7: Check for duplicate days in telemetry_daily_gaps
SELECT day, COUNT(*) AS dup_count
FROM telemetry_daily_gaps
WHERE day >= (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1)
GROUP BY day
HAVING COUNT(*) > 1
ORDER BY day DESC;
