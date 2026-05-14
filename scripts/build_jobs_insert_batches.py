#!/usr/bin/env python3
"""
build_jobs_insert_batches.py — Read mapped jobs JSON, emit chunked SQL INSERT
statements that can be fed to the Supabase `execute_sql` connector.

Usage:
    python3 scripts/build_jobs_insert_batches.py /tmp/naukrigulf_mapped.json /tmp/naukrigulf_sql/ --batch 50

Each output file contains one INSERT ... ON CONFLICT (external_id, source) DO NOTHING
RETURNING id; statement. The connector caller can then run them sequentially and
sum RETURNING row counts to get inserted vs skipped totals.
"""

import argparse
import json
import os
from pathlib import Path

COLS = [
    "external_id", "source", "title", "title_normalized",
    "company_name", "company_name_normalized", "company_id",
    "description", "location_raw", "location_country",
    "employment_type", "seniority_level",
    "salary_min", "salary_max", "salary_currency", "salary_text",
    "is_remote", "source_url", "application_url",
    "posted_at", "min_experience_years", "max_experience_years",
    "recruiter_name", "last_seen_at", "discovery_source",
    "enrichment_status", "raw_data",
]


def sql_quote(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dict) or isinstance(v, list):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    # string
    s = str(v).replace("'", "''")
    return f"'{s}'"


def row_to_values(row):
    parts = []
    for c in COLS:
        v = row.get(c)
        parts.append(sql_quote(v))
    return "(" + ", ".join(parts) + ")"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path")
    ap.add_argument("out_dir")
    ap.add_argument("--batch", type=int, default=50)
    args = ap.parse_args()

    with open(args.json_path) as f:
        rows = json.load(f)
    print(f"Loaded {len(rows)} rows")

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    n_files = 0
    col_list = ", ".join(COLS)
    for i in range(0, len(rows), args.batch):
        chunk = rows[i : i + args.batch]
        values = ",\n".join(row_to_values(r) for r in chunk)
        sql = (
            f"INSERT INTO public.jobs ({col_list}) VALUES\n"
            f"{values}\n"
            f"ON CONFLICT (external_id, source) DO NOTHING\n"
            f"RETURNING id;"
        )
        fname = out / f"batch_{i // args.batch:03d}.sql"
        with open(fname, "w") as f:
            f.write(sql)
        n_files += 1

    print(f"Wrote {n_files} batch files to {out}/")
    print(f"Avg batch size: {len(rows) / max(n_files, 1):.1f}")


if __name__ == "__main__":
    main()
