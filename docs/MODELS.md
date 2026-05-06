# Nexus — AI Model Usage

Single source of truth for which model is used where. Don't introduce a new model without updating this file.

| Use case | Model | Mode | Why |
|---|---|---|---|
| JD Analyzer (single JD, real-time) | GPT-4.1 mini | Real-time | Latency-sensitive admin UX. $0.40 / $1.60 per M tokens. |
| JD Pipeline (nightly batch, backfill) | GPT-4.1 mini | Batch API (50% off) | 18K+ jobs to backfill. 3 JDs per call (down from 5 — better accuracy). |
| Catalogs / taxonomy generation | GPT-5.4 | Real-time | High reasoning quality for one-off catalog work. |
| Reports (deep analysis, written deliverables) | Claude Sonnet 4.6 | Real-time | Long-form synthesis. |
| Survey AI wizard (Brief/Doc/Clone) | Claude Sonnet 4.6 | Real-time | JSON-schema tool use. |
| Server-side doc parsing (.docx/.pdf) | mammoth / pdf-parse | n/a | Pure code. Result fed into Claude. |

---

## Decisions

- **Skill cap per JD = 15.** Research-backed (Lightcast avg 13, ESCO 15-30 per occupation). The LLM picks the most important from the JD.
- **Batch size = 3 JDs/call.** 5 was tried; 3 gives better accuracy with marginal cost increase.
- **Confidence threshold = 0.6 (current), proposed 0.7.** Tunable in Notion master page section D2.
- **Min JD length = 100 chars (current), proposed 200/500.** Tunable in section D1.

---

## Cost model (annual, ~800K JDs)

- Real-time tier (single JD path): minimal — only on demand.
- Batch tier (nightly + backfill): ~$800-1,600/year on GPT-4.1 mini Batch API.

---

## Adding a new model

1. Add a row above with use case, mode, why.
2. Update Notion master doc section A1 if it's a JD/skill model.
3. Update `/docs/STATUS.md`.
