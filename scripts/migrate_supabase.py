"""
Supabase Migration Script
=========================
Run this once after creating your Supabase project to set up the schema.

Usage:
    DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres python scripts/migrate_supabase.py
"""

import os
import sys
import asyncio
import asyncpg


SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "..", "init", "supabase-schema.sql")


async def main():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: Set DATABASE_URL environment variable")
        print("  DATABASE_URL=postgresql://postgres:pass@db.xxxxx.supabase.co:5432/postgres")
        sys.exit(1)

    schema_path = os.path.abspath(SCHEMA_PATH)
    if not os.path.exists(schema_path):
        print(f"ERROR: Schema file not found at {schema_path}")
        sys.exit(1)

    print(f"Connecting to: {db_url[:30]}...")
    conn = await asyncpg.connect(db_url)

    try:
        with open(schema_path, "r") as f:
            sql = f.read()

        print("Executing schema...")
        await conn.execute(sql)
        print("Schema created successfully!")

        tables = await conn.fetch("""
            SELECT relname FROM pg_class
            WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
              AND relkind = 'r'
            ORDER BY relname
        """)
        print(f"\nTables created ({len(tables)}):")
        for t in tables:
            print(f"  - {t['relname']}")

        views = await conn.fetch("""
            SELECT relname FROM pg_class
            WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
              AND relkind = 'm'
            ORDER BY relname
        """)
        print(f"\nMaterialized Views ({len(views)}):")
        for v in views:
            print(f"  - {v['relname']}")

    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    finally:
        await conn.close()

    print("\nMigration complete!")
    print("\nNext steps:")
    print("  1. Set up cron jobs (Render Cron Jobs or pg_cron):")
    print("     REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_daily;")
    print("     REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_monthly;")
    print("     REFRESH MATERIALIZED VIEW CONCURRENTLY telemetry_monthly_deltas;")
    print("  2. Update .env with the Supabase DATABASE_URL")
    print("  3. Restart the API service")


if __name__ == "__main__":
    asyncio.run(main())
