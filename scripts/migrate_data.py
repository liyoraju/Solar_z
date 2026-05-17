"""
Migrate data from local Docker PostgreSQL to Neon.
Connects to local Docker Postgres + Neon, copies all tables,
then refreshes materialized views.

Usage:
    $env:DOCKER_DATABASE_URL="postgresql://solar:solar_secure_2024@localhost:5432/solar_platform"
    $env:DATABASE_URL="postgresql://neondb_owner:xxx@ep-xxx.aws.neon.tech/neondb?sslmode=require"
    python scripts/migrate_data.py
"""

import asyncio, os, sys, time
import asyncpg

BATCH = 2000

OLD_URL = os.getenv(
    "DOCKER_DATABASE_URL",
    "postgresql://solar:solar_secure_2024@localhost:5432/solar_platform",
)
NEW_URL = os.getenv("DATABASE_URL", "")

BIG_TABLES = [
    {"name": "telemetry", "order_by": "time"},
    {"name": "alerts",    "order_by": "id"},
]

SMALL_TABLES = ["billing_cycles", "inverters", "system_config"]


async def copy_big(old: asyncpg.Connection, new: asyncpg.Connection, tbl: str, order_by: str):
    cols_raw = await old.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position",
        tbl,
    )
    col_names = [r["column_name"] for r in cols_raw]
    skip = {"id"} if tbl == "alerts" else set()
    insert_cols = [c for c in col_names if c not in skip]
    all_cols_str = ", ".join(col_names)
    insert_cols_str = ", ".join(insert_cols)

    total = 0
    last_val = None
    t0 = time.time()

    while True:
        if last_val is None:
            rows = await old.fetch(
                f"SELECT {all_cols_str} FROM {tbl} ORDER BY {order_by} LIMIT $1", BATCH
            )
        else:
            rows = await old.fetch(
                f"SELECT {all_cols_str} FROM {tbl} WHERE {order_by} > $1 ORDER BY {order_by} LIMIT $2",
                last_val, BATCH,
            )
        if not rows:
            break

        vals = [tuple(r[c] for c in insert_cols) for r in rows]
        await new.copy_records_to_table(tbl, records=vals, columns=insert_cols)
        total += len(rows)
        last_val = rows[-1][order_by]
        print(f"  {tbl}: {total} rows", end="\r")

    print(f"  {tbl}: {total} rows in {time.time()-t0:.1f}s")
    return total


async def copy_small(old: asyncpg.Connection, new: asyncpg.Connection, tbl: str):
    cols_raw = await old.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position",
        tbl,
    )
    col_names = [r["column_name"] for r in cols_raw]
    col_list = ", ".join(col_names)
    ph = ", ".join(f"${i+1}" for i in range(len(col_names)))
    conflict = {"billing_cycles": "ON CONFLICT (cycle_start) DO NOTHING",
                "inverters": "ON CONFLICT (serial_number) DO UPDATE SET last_seen=EXCLUDED.last_seen, status=EXCLUDED.status",
                "system_config": "ON CONFLICT (key) DO NOTHING"}.get(tbl, "")
    sql = f"INSERT INTO {tbl} ({col_list}) VALUES ({ph}) {conflict}"

    rows = await old.fetch(f"SELECT {col_list} FROM {tbl} ORDER BY {col_names[0]}")
    if not rows:
        print(f"  {tbl}: 0 rows")
        return 0
    for r in rows:
        await new.execute(sql, *[r[c] for c in col_names])
    print(f"  {tbl}: {len(rows)} rows")
    return len(rows)


async def main():
    if not NEW_URL:
        print("ERROR: Set DATABASE_URL env var to Neon connection string")
        sys.exit(1)

    print(f"Old DB: {OLD_URL[:45]}...")
    print(f"New DB: {NEW_URL[:45]}...")
    print()

    old = await asyncpg.connect(OLD_URL)
    new = await asyncpg.connect(NEW_URL)

    try:
        total = 0
        for cfg in BIG_TABLES:
            total += await copy_big(old, new, cfg["name"], cfg["order_by"])
        for tbl in SMALL_TABLES:
            total += await copy_small(old, new, tbl)
        print(f"\nTotal: {total} rows migrated")

        print("\nRefreshing materialized views...")
        for mv in ("telemetry_daily", "telemetry_monthly", "telemetry_monthly_deltas"):
            s = time.time()
            try:
                await new.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
                print(f"  {mv} refreshed in {time.time()-s:.1f}s")
            except Exception:
                await new.execute(f"REFRESH MATERIALIZED VIEW {mv}")
                print(f"  {mv} refreshed (non-concurrent) in {time.time()-s:.1f}s")
        print("Done")

    finally:
        await old.close()
        await new.close()


if __name__ == "__main__":
    asyncio.run(main())
