#!/usr/bin/env python3
"""
import_naukrigulf_csv.py — One-shot importer for NaukriGulf Apify CSV exports.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      python3 scripts/import_naukrigulf_csv.py path/to/dataset.csv [--dry-run] [--batch 200]

Maps the 127-column NaukriGulf Apify (`apify/dataset_naukri-scraper_*.csv`) shape
into the Nexus `public.jobs` schema, mirroring the conventions of
`api/lib/helpers.ts::mapNaukriGulfJob` but adapted to the *flat CSV* surface.

Design:
- source = 'naukrigulf_csv'  (NOT 'naukrigulf.com' — see thread amb-uprc09)
  • Separates the clean numeric JobId namespace from the Apify SHA-256 stamped rows.
  • Re-running this CSV later dedupes via UNIQUE (external_id, source).
- external_id = raw JobId
- ON CONFLICT (external_id, source) DO NOTHING via REST POST with on_conflict + Prefer:resolution=ignore-duplicates
- Companies upserted by name (exact → name_normalized → insert) mirroring upsertCompanyByName.
- sanitizeCsvCell: 'undefined'/'null'/'nan'/'n/a' (case-insensitive) → empty string.

Idempotent. Safe to re-run.
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional, Dict, List, Tuple
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)

# ---------- Sanitizers ----------

GARBAGE = {"undefined", "null", "nan", "n/a", "none", ""}

def san(v: Any) -> str:
    """sanitizeCsvCell equivalent — empty for 'undefined'/'null'/'nan'/'n/a'."""
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in GARBAGE:
        return ""
    return s

def san_or_none(v: Any) -> Optional[str]:
    s = san(v)
    return s if s else None

def san_int(v: Any) -> Optional[int]:
    s = san(v)
    if not s:
        return None
    try:
        f = float(s)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return int(f)
    except (ValueError, TypeError):
        return None

def san_num(v: Any) -> Optional[float]:
    s = san(v)
    if not s:
        return None
    try:
        f = float(s)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    except (ValueError, TypeError):
        return None

def san_bool(v: Any) -> Optional[bool]:
    s = san(v).lower()
    if s in ("true", "1", "yes", "y"):
        return True
    if s in ("false", "0", "no", "n"):
        return False
    return None

# ---------- Normalizers (mirror api/lib/helpers.ts) ----------

def normalize_text(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.lower().strip())

CORP_SUFFIX = re.compile(
    r"\s*(pvt\.?\s*ltd\.?|ltd\.?|inc\.?|llc|corp\.?|corporation|private\s+limited|limited|india)\s*$",
    re.IGNORECASE,
)

def normalize_company_name(name: str) -> str:
    if not name:
        return ""
    s = name.lower()
    s = CORP_SUFFIX.sub("", s)
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def parse_domain(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if not u.startswith("http"):
        u = "https://" + u
    try:
        host = urlparse(u).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host or None
    except Exception:
        return None

# ---------- Employment type mapping (mirror api/lib/helpers.ts:mapEmploymentType) ----------

def map_employment_type(s: str) -> Optional[str]:
    """Map CSV employmentType → jobs.employment_type enum-ish text."""
    if not s:
        return None
    low = s.lower()
    if "full" in low:
        return "full_time"
    if "part" in low:
        return "part_time"
    if "contract" in low:
        return "contract"
    if "intern" in low:
        return "internship"
    if "temp" in low:
        return "temporary"
    if "free" in low:
        return "other"  # employment_type enum has no 'freelance'; bucket as 'other'
    return None

# ---------- Country normalization ----------

UAE_VARIANTS = {"united arab emirates (uae)", "united arab emirates", "uae", "u.a.e."}

def normalize_country(s: str) -> Optional[str]:
    """Strip '(UAE)' suffix; map common variants."""
    if not s:
        return None
    low = s.strip().lower()
    if low in UAE_VARIANTS:
        return "United Arab Emirates"
    # Strip trailing parenthesized aliases
    cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", s.strip())
    return cleaned or s.strip()

# ---------- CSV → row mapper ----------

SOURCE = "naukrigulf_csv"
DISCOVERY_SOURCE = "naukrigulf_csv"

def build_description(row: Dict[str, str]) -> Optional[str]:
    parts = []
    desc = san(row.get("Description") or row.get("basicInfo/description"))
    if desc:
        parts.append(desc)
    desired = san(row.get("DesiredCandidate/Profile"))
    if desired:
        parts.append(f"\n\nDesired Candidate:\n{desired}")
    out = "".join(parts).strip()
    return out or None

def build_keywords(row: Dict[str, str]) -> Optional[List[str]]:
    raw = san(row.get("Other/Keywords"))
    if not raw:
        return None
    # CSV stores keywords as comma- or pipe-separated string
    items = re.split(r"[,|;]\s*", raw)
    items = [i.strip() for i in items if i.strip()]
    return items or None

def epoch_to_iso(v: Any) -> Optional[str]:
    s = san(v)
    if not s:
        return None
    try:
        # Accept both seconds and milliseconds
        n = int(float(s))
        if n > 10_000_000_000:  # ms
            n = n // 1000
        return datetime.fromtimestamp(n, tz=timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError, OSError):
        return None

def csv_to_job_row(row: Dict[str, str], company_id: Optional[str], now_iso: str) -> Optional[Dict[str, Any]]:
    job_id = san(row.get("JobId") or row.get("basicInfo/jobId"))
    if not job_id:
        return None

    title = san(row.get("Designation") or row.get("basicInfo/designation"))
    if not title:
        title = "Unknown"

    company_name = san(row.get("Company/Name") or row.get("basicInfo/company/name"))
    location_raw = san(row.get("Location") or row.get("basicInfo/location"))
    country = normalize_country(san(row.get("Compensation/Country") or row.get("Compensation/CurrentCountry")))

    exp_min = san_int(row.get("DesiredCandidate/Experience/MinExperience") or row.get("basicInfo/experience/min"))
    exp_max = san_int(row.get("DesiredCandidate/Experience/MaxExperience") or row.get("basicInfo/experience/max"))

    salary_min = san_num(row.get("Compensation/MinCtc"))
    salary_max = san_num(row.get("Compensation/MaxCtc"))
    salary_currency = san_or_none(row.get("Compensation/jobMinCurrency") or row.get("Compensation/jobMaxCurrency"))
    is_ctc_hidden = san_bool(row.get("Compensation/IsCtcHidden"))
    salary_text = None
    if is_ctc_hidden is True:
        salary_text = "Not disclosed"
        # Hidden salary → don't trust min/max
        salary_min = None
        salary_max = None

    description = build_description(row)
    employment_type = map_employment_type(san(row.get("employmentType") or row.get("employmentTypeKey")))

    source_url = san_or_none(row.get("JdURL"))
    application_url = san_or_none(row.get("url"))

    posted_at = epoch_to_iso(row.get("Other/PostedDate") or row.get("basicInfo/latestPostedDate") or row.get("Compensation/LatestPostedDate"))

    # is_remote — derive from locationTypeKey if present
    loc_type_key = san(row.get("locationTypeKey")).lower()
    is_remote = True if loc_type_key in ("remote", "wfh", "work-from-home") else None

    # raw_data — keep meaningful subset (not 127 columns)
    raw_data = {
        "_imported_from": "naukrigulf_csv",
        "_imported_at": now_iso,
        "JobId": job_id,
        "Designation": title,
        "Company/Name": company_name or None,
        "Company/Id": san_or_none(row.get("Company/Id")),
        "Company/Profile": san_or_none(row.get("Company/Profile")),
        "LogoUrl": san_or_none(row.get("LogoUrl")),
        "Location": location_raw or None,
        "Compensation/Country": san_or_none(row.get("Compensation/Country")),
        "Compensation/IsCtcHidden": is_ctc_hidden,
        "Compensation/salaryTimeBrand": san_or_none(row.get("Compensation/salaryTimeBrand")),
        "Compensation/MinCtc": san_or_none(row.get("Compensation/MinCtc")),
        "Compensation/MaxCtc": san_or_none(row.get("Compensation/MaxCtc")),
        "DesiredCandidate/Experience/MinExperience": exp_min,
        "DesiredCandidate/Experience/MaxExperience": exp_max,
        "JdURL": source_url,
        "url": application_url,
        "scrapedAt": san_or_none(row.get("scrapedAt")),
        "Other/PostedDate": san_or_none(row.get("Other/PostedDate")),
        "FunctionalArea": san_or_none(row.get("FunctionalArea")),
        "IndustryType": san_or_none(row.get("IndustryType")),
        "employmentType": san_or_none(row.get("employmentType")),
        "locality": san_or_none(row.get("locality")),
        "Other/Keywords": san_or_none(row.get("Other/Keywords")),
        "Other/jobSource": san_or_none(row.get("Other/jobSource")),
        "source": "naukrigulf",
    }

    return {
        "external_id": job_id,
        "source": SOURCE,
        "title": title,
        "title_normalized": normalize_text(title) or None,
        "company_name": company_name or None,
        "company_name_normalized": normalize_text(company_name) if company_name else None,
        "company_id": company_id,
        "description": description,
        "location_raw": location_raw or None,
        "location_country": country,
        "employment_type": employment_type,
        "seniority_level": None,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": salary_currency,
        "salary_text": salary_text,
        "is_remote": is_remote,
        "source_url": source_url,
        "application_url": application_url,
        "posted_at": posted_at,
        "min_experience_years": exp_min,
        "max_experience_years": exp_max,
        "recruiter_name": None,
        "last_seen_at": now_iso,
        "discovery_source": DISCOVERY_SOURCE,
        "enrichment_status": "partial" if description else "pending",
        "raw_data": raw_data,
    }

# ---------- Supabase REST helpers ----------

class SBClient:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip("/")
        self.h = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def select_company(self, name: str, name_norm: Optional[str]) -> Optional[Dict]:
        # Exact name match
        r = requests.get(
            f"{self.url}/rest/v1/companies",
            params={"select": "id,website,logo_url,linkedin_url,domain,name,name_normalized",
                    "name": f"eq.{name}", "limit": "1"},
            headers=self.h, timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        if data:
            return data[0]
        # Normalized fallback
        if name_norm:
            r = requests.get(
                f"{self.url}/rest/v1/companies",
                params={"select": "id,website,logo_url,linkedin_url,domain,name,name_normalized",
                        "name_normalized": f"eq.{name_norm}", "limit": "1"},
                headers=self.h, timeout=30,
            )
            r.raise_for_status()
            data = r.json()
            if data:
                return data[0]
        return None

    def update_company(self, company_id: str, patch: Dict[str, Any]) -> None:
        if not patch:
            return
        r = requests.patch(
            f"{self.url}/rest/v1/companies",
            params={"id": f"eq.{company_id}"},
            headers={**self.h, "Prefer": "return=minimal"},
            json=patch, timeout=30,
        )
        r.raise_for_status()

    def insert_company(self, payload: Dict[str, Any]) -> Optional[str]:
        r = requests.post(
            f"{self.url}/rest/v1/companies",
            headers={**self.h, "Prefer": "return=representation"},
            json=payload, timeout=30,
        )
        if r.status_code >= 400:
            print(f"  WARN: company insert failed {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return None
        data = r.json()
        return data[0]["id"] if data else None

    def upsert_company_by_name(self, name: str, logo_url: Optional[str], website: Optional[str]) -> Optional[str]:
        """Mirror api/lib/helpers.ts::upsertCompanyByName."""
        clean = (name or "").strip()
        if not clean or clean.lower() in GARBAGE:
            return None
        name_norm = normalize_company_name(clean) or None
        incoming_domain = parse_domain(website)
        existing = self.select_company(clean, name_norm)
        if existing:
            patch = {}
            if not existing.get("website") and website:
                patch["website"] = website
            if not existing.get("logo_url") and logo_url:
                patch["logo_url"] = logo_url
            if not existing.get("domain") and incoming_domain:
                patch["domain"] = incoming_domain
            if patch:
                self.update_company(existing["id"], patch)
            return existing["id"]
        payload = {
            "name": clean,
            "name_normalized": name_norm,
            "enrichment_status": "pending",
        }
        if incoming_domain:
            payload["domain"] = incoming_domain
        if website:
            payload["website"] = website
        if logo_url:
            payload["logo_url"] = logo_url
        return self.insert_company(payload)

    def insert_jobs_batch(self, rows: List[Dict[str, Any]]) -> Tuple[int, int, List[str]]:
        """
        POST /jobs with on_conflict=external_id,source + Prefer: resolution=ignore-duplicates,return=representation.
        Returns (inserted, skipped, errors).
        """
        if not rows:
            return (0, 0, [])
        r = requests.post(
            f"{self.url}/rest/v1/jobs",
            params={"on_conflict": "external_id,source"},
            headers={**self.h, "Prefer": "resolution=ignore-duplicates,return=representation"},
            json=rows, timeout=120,
        )
        if r.status_code >= 400:
            return (0, 0, [f"HTTP {r.status_code}: {r.text[:500]}"])
        data = r.json()
        inserted = len(data)
        skipped = len(rows) - inserted
        return (inserted, skipped, [])

# ---------- Main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", help="Path to NaukriGulf Apify CSV")
    ap.add_argument("--batch", type=int, default=200, help="Insert batch size (default 200)")
    ap.add_argument("--dry-run", action="store_true", help="Parse + map, don't write")
    ap.add_argument("--limit", type=int, default=0, help="Limit row count (debug)")
    ap.add_argument("--emit-json", type=str, default="", help="Path to dump mapped rows as JSON (skips REST insert; companies still resolved if env keys present)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    write_mode = not args.dry_run and not args.emit_json
    if write_mode and (not url or not key):
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (or use --dry-run / --emit-json)", file=sys.stderr)
        sys.exit(2)

    print(f"[{datetime.now().isoformat()}] Reading {args.csv_path} ...")
    with open(args.csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if args.limit:
        rows = rows[: args.limit]
    print(f"  CSV rows: {len(rows)}")

    # Dedupe by JobId inside the CSV (keep first occurrence)
    seen_ids = set()
    unique_rows = []
    for r in rows:
        jid = san(r.get("JobId") or r.get("basicInfo/jobId"))
        if not jid or jid in seen_ids:
            continue
        seen_ids.add(jid)
        unique_rows.append(r)
    print(f"  Unique JobIds: {len(unique_rows)}  (in-CSV dupes skipped: {len(rows) - len(unique_rows)})")

    client = SBClient(url, key) if (url and key) else None
    now_iso = datetime.now(tz=timezone.utc).isoformat()

    # Company upsert cache (name → id)
    company_cache: Dict[str, Optional[str]] = {}

    # Resolve companies first (sequentially — single small request each)
    if client is not None:
        print(f"[{datetime.now().isoformat()}] Resolving companies ...")
        unique_companies: Dict[str, Tuple[Optional[str], Optional[str]]] = {}
        for r in unique_rows:
            cn = san(r.get("Company/Name") or r.get("basicInfo/company/name"))
            if not cn:
                continue
            if cn not in unique_companies:
                unique_companies[cn] = (
                    san_or_none(r.get("LogoUrl")),
                    san_or_none(r.get("Company/Profile")) if (san_or_none(r.get("Company/Profile")) or "").startswith("http") else None,
                )
        print(f"  Distinct companies: {len(unique_companies)}")
        for idx, (cn, (logo, website)) in enumerate(unique_companies.items()):
            try:
                company_cache[cn] = client.upsert_company_by_name(cn, logo, website)
            except Exception as e:
                print(f"  WARN: company '{cn[:60]}' failed: {e}", file=sys.stderr)
                company_cache[cn] = None
            if (idx + 1) % 50 == 0:
                print(f"  ... {idx + 1}/{len(unique_companies)}")
        resolved = sum(1 for v in company_cache.values() if v)
        print(f"  Companies resolved: {resolved}/{len(unique_companies)}")

    # Map rows
    print(f"[{datetime.now().isoformat()}] Mapping rows ...")
    mapped: List[Dict[str, Any]] = []
    mapping_failures = 0
    for r in unique_rows:
        cn = san(r.get("Company/Name") or r.get("basicInfo/company/name"))
        cid = company_cache.get(cn) if cn else None
        row = csv_to_job_row(r, cid, now_iso)
        if row is None:
            mapping_failures += 1
            continue
        mapped.append(row)
    print(f"  Mapped: {len(mapped)}  (skipped: {mapping_failures})")

    if args.emit_json:
        with open(args.emit_json, "w") as f:
            json.dump(mapped, f, default=str, ensure_ascii=False)
        print(f"  Wrote {len(mapped)} rows → {args.emit_json}")
        return

    if args.dry_run:
        # Print first row as sample
        print("\n--- Sample mapped row (dry-run) ---")
        print(json.dumps(mapped[0], indent=2, default=str)[:2000])
        print("\n--- Stats ---")
        with_desc = sum(1 for m in mapped if m.get("description"))
        with_country = sum(1 for m in mapped if m.get("location_country"))
        with_emp = sum(1 for m in mapped if m.get("employment_type"))
        with_posted = sum(1 for m in mapped if m.get("posted_at"))
        print(f"  description: {with_desc}/{len(mapped)}")
        print(f"  location_country: {with_country}/{len(mapped)}")
        print(f"  employment_type: {with_emp}/{len(mapped)}")
        print(f"  posted_at: {with_posted}/{len(mapped)}")
        return

    # Batch insert
    print(f"[{datetime.now().isoformat()}] Inserting in batches of {args.batch} ...")
    total_inserted = 0
    total_skipped = 0
    errors: List[str] = []
    for i in range(0, len(mapped), args.batch):
        chunk = mapped[i : i + args.batch]
        try:
            ins, sk, errs = client.insert_jobs_batch(chunk)
            total_inserted += ins
            total_skipped += sk
            errors.extend(errs)
            print(f"  batch {i // args.batch + 1}: inserted={ins} skipped={sk} (cumulative {total_inserted}/{i+len(chunk)})")
            if errs:
                for e in errs:
                    print(f"    ERROR: {e}", file=sys.stderr)
        except Exception as e:
            errors.append(str(e))
            print(f"  batch {i // args.batch + 1} EXCEPTION: {e}", file=sys.stderr)
        time.sleep(0.1)  # gentle pace

    print(f"\n[{datetime.now().isoformat()}] DONE")
    print(f"  Total CSV rows:       {len(rows)}")
    print(f"  Unique JobIds:        {len(unique_rows)}")
    print(f"  Mapped rows:          {len(mapped)}")
    print(f"  Inserted into jobs:   {total_inserted}")
    print(f"  Skipped (dupes/RLS):  {total_skipped}")
    print(f"  Errors:               {len(errors)}")
    if errors:
        for e in errors[:5]:
            print(f"    - {e}")

if __name__ == "__main__":
    main()
