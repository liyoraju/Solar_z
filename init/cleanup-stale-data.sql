-- =============================================
-- Neon Database Cleanup Script
-- Run against your Neon production database
-- to remove stale data that inflates totals
-- =============================================

-- 1. Identify current cycle start date
SELECT cycle_start AS current_cycle_start
FROM billing_cycles
WHERE cycle_end IS NULL
ORDER BY cycle_start DESC
LIMIT 1;

-- 2. Check for stale telemetry_daily records before cycle start
SELECT 'telemetry_daily' AS table_name,
       COUNT(*) AS record_count,
       MIN(day) AS earliest,
       MAX(day) AS latest
FROM telemetry_daily
WHERE day < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- 3. Check for stale telemetry_daily_gaps records before cycle start
SELECT 'telemetry_daily_gaps' AS table_name,
       COUNT(*) AS record_count,
       MIN(day) AS earliest,
       MAX(day) AS latest
FROM telemetry_daily_gaps
WHERE day < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- 4. Check for stale telemetry records before cycle start
SELECT 'telemetry' AS table_name,
       COUNT(*) AS record_count,
       MIN(time) AS earliest,
       MAX(time) AS latest
FROM telemetry
WHERE time < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- 5. Check for stale gap alerts
SELECT 'telemetry_gap_alerts' AS table_name,
       COUNT(*) AS record_count,
       MIN(created_at) AS earliest,
       MAX(created_at) AS latest
FROM telemetry_gap_alerts
WHERE created_at < NOW() - INTERVAL '30 days';

-- =============================================
-- CLEANUP SECTION (uncomment to execute)
-- =============================================

-- Remove telemetry_daily records before current cycle
-- DELETE FROM telemetry_daily
-- WHERE day < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- Remove telemetry_daily_gaps records before current cycle
-- DELETE FROM telemetry_daily_gaps
-- WHERE day < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- Remove telemetry records before current cycle
-- DELETE FROM telemetry
-- WHERE time < (SELECT cycle_start FROM billing_cycles WHERE cycle_end IS NULL LIMIT 1);

-- Remove old gap alerts (older than 30 days)
-- DELETE FROM telemetry_gap_alerts
-- WHERE created_at < NOW() - INTERVAL '30 days';

-- Remove old alerts (older than 30 days)
-- DELETE FROM alerts
-- WHERE created_at < NOW() - INTERVAL '30 days';

-- =============================================
-- VERIFY AFTER CLEANUP
-- =============================================

-- Check current cycle totals
SELECT
    cycle_start,
    total_production_kwh,
    total_savings,
    day_count
FROM billing_cycles
WHERE cycle_end IS NULL
ORDER BY cycle_start DESC
LIMIT 1;

-- Check record counts after cleanup
SELECT 'telemetry_daily' AS table_name, COUNT(*) AS count FROM telemetry_daily
UNION ALL
SELECT 'telemetry_daily_gaps', COUNT(*) FROM telemetry_daily_gaps
UNION ALL
SELECT 'telemetry', COUNT(*) FROM telemetry
UNION ALL
SELECT 'telemetry_gap_alerts', COUNT(*) FROM telemetry_gap_alerts
UNION ALL
SELECT 'alerts', COUNT(*) FROM alerts;
