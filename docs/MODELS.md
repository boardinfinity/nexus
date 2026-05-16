# Nexus — AI Model Usage

Single source of truth for which model is used where. Don't introduce a new model without updating this file (per Norm 12).

| Use case | Model | Mode | Why |
|---|---|---|---|
| JD Analyzer (single JD, real-time) | **GPT-4.1 mini** | Real-time | Latency-sensitive admin UX. ~$0.40 / $1.60 per M tokens. |
| JD Pipeline (nightly batch, backfill) | **GPT-4.1 mini** | OpenAI **Batch API** (50% off) | 18K+ jobs backfill scale. 3 JDs per call (5 was tried; 3 = better accuracy). |
| JD Fetch — Google Search extraction | **GPT-4.1 mini** | Real-time | Location-aware structured extraction from search results. Phase 3 (commit 0e71c94). |
| UAE/GCC re-extraction worker | **GPT-4.1 mini** | Real-time, batched 25/tick × concurrency=5 | Vercel-resumable. ~3,404 UAE jobs in initial run. |
| Catalogs / taxonomy generation (one-off) | **GPT-5.4** | Real-time | Highest reasoning quality for one-off catalog work. |
| Reports (deep analysis, written deliverables) | **Claude Sonnet 4.6** | Real-time | Long-form synthesis. |
| Survey AI wizard (Brief/Doc/Clone) | **Claude Sonnet 4.6** | Real-time | JSON-schema tool use. |
| Server-side doc parsing (.docx/.pdf) | `mammoth` / `pdf-parse` | n/a | Pure code. Result fed into Claude. |
| **Nexus SLM (positioning, not yet trained)** | **Qwen-2.5-3B** (planned fine-tune) | Future | Marketing page positioning landed. Training data + fine-tune work future (P6). |

---

## Decisions

- **Skill cap per JD = 15.** Research-backed (Lightcast avg 13, ESCO 15-30 per occupation). The LLM picks the most important from the JD.
- **Batch size = 3 JDs/call** (real-time pipeline); **batch size = 8** in the stateless bulk cron (a787150).
- **Confidence threshold = 0.6** (current); proposed 0.7. Tunable in Notion master page section D2.
- **Min JD length = 100 chars** (current); proposed 200/500. Tunable in section D1.
- **Bucket resolver tiers**: validated ≥50% → auto_assign; candidate ≥50% → tentative; else → auto_create (commit 4929e2f).
- **Per-invocation cap**: jd_enrichment 100/run (commit 96d8b34), concurrency=3, ~5.3s/job → fits 300s Vercel cap.

---

## Cost model (annual, target scale)

- **Real-time tier** (single JD path): minimal — only on demand.
- **Batch tier** (nightly + backfill): ~$800-1,600/year on GPT-4.1 mini Batch API at 800K JDs.
- **Per-college tier**: target <$X/college/month — tracked in weekly cost digest (Norm 9).

---

## Per-norm enforcement

- **Norm 3:** when monthly OpenAI or Anthropic spend > 70% of budget, flag in the weekly digest.
- **Norm 6:** every server call to OpenAI/Anthropic must `Sentry.captureException` on catch.
- **Norm 7:** every AI-generated table has `analysis_version` so we can re-run and diff.

---

## Adding a new model

1. Add a row above with use case, mode, why.
2. Update Notion master doc section A1 if it's a JD/skill model.
3. Update `/docs/STATUS.md`.
4. Update the relevant env var in `ENV.md` if a new API key is needed.
