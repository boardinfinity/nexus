/**
 * api/lib/excel-parse.ts
 * ─────────────────────────────────────────────────────────────────────
 * Server-side Excel parsing helper for Campus JD Upload v2 (UOWD ingest).
 *
 * Two supported shapes:
 *   Track A — Full-JD Excel  (e.g. UOWD-Detailed-Descriptions-2025-2026.xlsx)
 *     Header at row 1. Required columns: a title column + a description column.
 *     Each row becomes an async analyze task (campus_excel_tasks).
 *
 *   Track B — Vacancy log    (e.g. UOWD-2023-2025-Job-Roles.xlsx)
 *     Header may be at row N (UOWD sheets put it at row 4 with blank rows
 *     above). No description column. Each row becomes a campus_vacancies row.
 *
 * Detection is header-based (no LLM): if a description-like column exists →
 * Track A; if a vacancy-title column exists with no description → Track B;
 * otherwise we return shape='unknown' and let the UI ask the user to map.
 *
 * Author: thread camjdbcab
 * Date:   2026-05-15
 */

import * as XLSX from "xlsx";

// ── Constants ────────────────────────────────────────────────────────

/** Max rows we'll parse from a single file. Hard cap to protect memory. */
export const MAX_EXCEL_ROWS = 5000;

/** How many rows above row 1 we'll scan when looking for the real header. */
const HEADER_SCAN_DEPTH = 10;

/** Min chars for a Track A description to be considered analyzable. */
export const MIN_DESCRIPTION_CHARS = 80;

// ── Types ────────────────────────────────────────────────────────────

export type DetectedTrack = "track_a_full_jd" | "track_b_vacancy_log" | "unknown";

/** Field roles we try to auto-map to columns. */
export type FieldRole =
  | "title"
  | "employer"
  | "description"
  | "employer_description"
  | "posting_date"
  | "hours_per_week"
  | "degree_level"
  | "desired_majors"
  | "publishing_channel"
  | "start_date"
  | "end_date";

export interface ColumnMapping {
  /** Mapping of field role → 0-based column index in the sheet. */
  [role: string]: number | undefined;
}

export interface ParseResult {
  sheet_name: string;
  total_rows: number;             // data rows (post-header)
  header_row_index: number;       // 0-based row index where the header sits
  headers: string[];              // raw header cell text (column order)
  detected_track: DetectedTrack;
  column_mapping: ColumnMapping;  // suggested mapping; client may override
  preview_rows: Record<string, any>[];  // first 5 data rows as { headerName: value }
}

export interface ExtractedRow {
  excel_row_index: number;        // 1-based for human display (sheet row number)
  title: string | null;
  employer: string | null;
  description: string | null;
  publishing_channel: string | null;
  start_date: string | null;      // ISO yyyy-mm-dd or null
  end_date: string | null;
  raw_metadata: Record<string, any>;
}

export interface ParsedTitleSplit {
  vacancy_external_id: string | null;  // e.g. "UOWD10674"
  parsed_roles: string | null;
  parsed_employer: string | null;
}

// ── Header heuristics ────────────────────────────────────────────────

/** Normalize a header cell for matching: lowercase, collapse whitespace. */
function normHeader(s: any): string {
  if (s === null || s === undefined) return "";
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Match a normalized header against a role's canonical synonyms.
 * Returns true if the header contains any of the role's keywords.
 */
const ROLE_PATTERNS: Record<FieldRole, RegExp[]> = {
  title: [/\b(job\s*title|vacancy\s*title|role\s*title|position\s*title|title)\b/],
  employer: [/\b(employer|company\s*name|company|organization|organisation|hiring\s*company)\b/],
  description: [/\b(description|job\s*description|jd\s*text|job\s*details)\b/],
  employer_description: [/\b(employer\s*description|company\s*description|about\s*(the)?\s*company)\b/],
  posting_date: [/\b(posting\s*date|posted\s*on|date\s*posted|published\s*date)\b/],
  hours_per_week: [/\b(hours\s*per\s*week|hours\/week|weekly\s*hours)\b/],
  degree_level: [/\b(degree\s*level|qualification|education\s*level)\b/],
  desired_majors: [/\b(desired\s*majors?|preferred\s*majors?|majors?)\b/],
  publishing_channel: [/\b(publishing\s*channel|channel|posted\s*via|source)\b/],
  start_date: [/\b(start\s*date|from\s*date|opens?\s*on)\b/],
  end_date: [/\b(end\s*date|to\s*date|closes?\s*on|deadline|expiry)\b/],
};

/** First column index whose header matches the role; -1 if none. */
function findColumnForRole(headers: string[], role: FieldRole): number {
  const patterns = ROLE_PATTERNS[role];
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (!h) continue;
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

// ── Header row detection ─────────────────────────────────────────────

/**
 * Find the first row whose non-empty cells look like header labels
 * (text strings, not dates/numbers, ≥2 of them, contains at least one
 * recognizable role pattern). Falls back to row 0 (1-based row 1).
 */
function detectHeaderRow(matrix: any[][]): number {
  const depth = Math.min(matrix.length, HEADER_SCAN_DEPTH);
  for (let r = 0; r < depth; r++) {
    const row = matrix[r] || [];
    const cells = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (cells.length < 2) continue;

    // All cells in candidate row must be string-ish and short-ish (not paragraph text)
    const allShortStrings = cells.every(
      (c) => typeof c === "string" && c.length < 80 && !/^\d{4}-\d{2}-\d{2}/.test(c)
    );
    if (!allShortStrings) continue;

    // Must match at least one canonical role
    const normalized = cells.map(normHeader);
    const hasRole = (Object.keys(ROLE_PATTERNS) as FieldRole[]).some((role) =>
      normalized.some((h) => ROLE_PATTERNS[role].some((p) => p.test(h)))
    );
    if (hasRole) return r;
  }
  return 0;
}

// ── Excel value coercion ─────────────────────────────────────────────

/** Convert an Excel date-y cell to ISO yyyy-mm-dd or null. */
function coerceDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date — XLSX library normally converts these to JS Date when
    // cellDates:true is set, but be defensive.
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    // Already ISO?
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    // dd-MMM-yyyy (e.g. "12-Sep-2025")
    const monMatch = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,9})[-\/\s](\d{4})$/);
    if (monMatch) {
      const months: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const key = monMatch[2].toLowerCase().slice(0, 3);
      const m = months[key];
      if (m) {
        const day = monMatch[1].padStart(2, "0");
        return `${monMatch[3]}-${m}-${day}`;
      }
    }
    // dd/mm/yyyy or dd-mm-yyyy
    const numMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (numMatch) {
      return `${numMatch[3]}-${numMatch[2].padStart(2, "0")}-${numMatch[1].padStart(2, "0")}`;
    }
    return null;
  }
  return null;
}

/** Coerce any cell to a trimmed string or null. */
function coerceString(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

// ── Track-B title regex ──────────────────────────────────────────────

/**
 * Split a UOWD vacancy title like:
 *   "UOWD10674 - Emarat Al Aman (4 day Paid Volunteering Experience) - UXE Securities"
 * into { vacancy_external_id: "UOWD10674", parsed_roles: "Emarat Al Aman ...", parsed_employer: "UXE Securities" }.
 *
 * Greedy on the last " - " so employer is the trailing chunk and the rest is roles.
 */
export function splitVacancyTitle(raw: string): ParsedTitleSplit {
  if (!raw) return { vacancy_external_id: null, parsed_roles: null, parsed_employer: null };
  const s = raw.trim();
  const m = s.match(/^(UOWD\d+)\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+)$/i);
  if (m) {
    return {
      vacancy_external_id: m[1].toUpperCase(),
      parsed_roles: m[2].trim() || null,
      parsed_employer: m[3].trim() || null,
    };
  }
  // No employer separator — keep whole thing as roles
  const idOnly = s.match(/^(UOWD\d+)\s*[-–—]\s*(.+)$/i);
  if (idOnly) {
    return {
      vacancy_external_id: idOnly[1].toUpperCase(),
      parsed_roles: idOnly[2].trim() || null,
      parsed_employer: null,
    };
  }
  return { vacancy_external_id: null, parsed_roles: s || null, parsed_employer: null };
}

// ── Top-level parse entrypoint ───────────────────────────────────────

/**
 * Parse an Excel buffer and detect its shape. Returns header, mapping,
 * and a 5-row preview. Does NOT extract full rows — call extractRows()
 * after the client confirms (or overrides) the mapping.
 */
export function parseExcelBuffer(buf: Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found in workbook");
  const ws = wb.Sheets[sheetName];

  // Get full sheet as 2D matrix (string + null), preserving blanks.
  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  }) as any[][];

  if (matrix.length === 0) {
    throw new Error("Sheet is empty");
  }

  const headerRowIdx = detectHeaderRow(matrix);
  const headerRow = matrix[headerRowIdx] || [];
  const headers = headerRow.map((h: any) => (h === null || h === undefined ? "" : String(h).trim()));

  // Auto-map roles
  const mapping: ColumnMapping = {};
  for (const role of Object.keys(ROLE_PATTERNS) as FieldRole[]) {
    const idx = findColumnForRole(headers, role);
    if (idx >= 0) mapping[role] = idx;
  }

  // Detect track
  let track: DetectedTrack = "unknown";
  if (mapping.description !== undefined && mapping.title !== undefined) {
    track = "track_a_full_jd";
  } else if (mapping.title !== undefined && mapping.description === undefined) {
    track = "track_b_vacancy_log";
  }

  // Preview rows (first 5 data rows after header)
  const previewRows: Record<string, any>[] = [];
  for (let r = headerRowIdx + 1; r < Math.min(matrix.length, headerRowIdx + 6); r++) {
    const row = matrix[r] || [];
    // Skip completely empty rows
    if (row.every((c: any) => c === null || c === undefined || String(c).trim() === "")) continue;
    const obj: Record<string, any> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      const val = row[c];
      obj[key] = val instanceof Date ? val.toISOString().slice(0, 10) : val;
    }
    previewRows.push(obj);
  }

  // Count data rows (non-empty)
  let totalRows = 0;
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (row.some((c: any) => c !== null && c !== undefined && String(c).trim() !== "")) {
      totalRows++;
    }
  }

  return {
    sheet_name: sheetName,
    total_rows: totalRows,
    header_row_index: headerRowIdx,
    headers,
    detected_track: track,
    column_mapping: mapping,
    preview_rows: previewRows,
  };
}

/**
 * Extract all data rows using a (possibly client-overridden) column mapping.
 * Caps at MAX_EXCEL_ROWS. Returns ExtractedRow[] with normalized fields +
 * the original raw cells in raw_metadata for traceability.
 */
export function extractRows(buf: Buffer, mapping: ColumnMapping, headerRowIdx: number): ExtractedRow[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  }) as any[][];

  const headerRow = matrix[headerRowIdx] || [];
  const headers = headerRow.map((h: any) => (h === null || h === undefined ? "" : String(h).trim()));

  const get = (row: any[], role: FieldRole): any => {
    const idx = mapping[role];
    if (idx === undefined || idx < 0) return null;
    return row[idx] ?? null;
  };

  const out: ExtractedRow[] = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (row.every((c: any) => c === null || c === undefined || String(c).trim() === "")) continue;

    const raw_metadata: Record<string, any> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      const v = row[c];
      raw_metadata[key] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }

    out.push({
      excel_row_index: r + 1, // 1-based for humans
      title: coerceString(get(row, "title")),
      employer: coerceString(get(row, "employer")),
      description: coerceString(get(row, "description")),
      publishing_channel: coerceString(get(row, "publishing_channel")),
      start_date: coerceDate(get(row, "start_date")),
      end_date: coerceDate(get(row, "end_date")),
      raw_metadata,
    });

    if (out.length >= MAX_EXCEL_ROWS) break;
  }
  return out;
}
