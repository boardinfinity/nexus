# Nexus — Environment Variables & Infra Plan

All env vars live in Vercel (Production + Preview) unless noted. Update both environments together.

> Per Norm 3 (Infra Scaling Prompts): every contributor watches the caps listed at the bottom of this file and surfaces breaches proactively. Per Norm 4: every secret is an env var; never hardcoded.

---

## Required env vars

| Variable | Required | Where | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | Vercel | Project `jlgstbucwawuntatrgvy` (region `aws-0-ap-south-1`, Mumbai) |
| `SUPABASE_ANON_KEY` | ✅ | Vercel | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Vercel | Server-side only |
| `APIFY_API_KEY` | ✅ | Vercel | Personal Scale plan, $199/mo, $0.16/CU |
| `OPENAI_API_KEY` | ✅ | Vercel | JD Analyzer + JD Fetch + Batch API |
| `ANTHROPIC_API_KEY` | ✅ | Vercel | Survey AI wizard (Claude Sonnet 4.6) + reports |
| `MANDRILL_API_KEY` | ✅ | Vercel | Replaced Resend |
| `MANDRILL_FROM_EMAIL` | ✅ | Vercel | `surveys@boardinfinity.com` (must be Mandrill-verified) |
| `MANDRILL_FROM_NAME` | ✅ | Vercel | `Board Infinity Surveys` |
| `JWT_SECRET` | ✅ | Vercel | Survey OTP / per-slug share token signing |
| `CRON_SECRET` | ✅ | Vercel | Gates `/public/extract-uae-job-skills/tick` and other self-recursive workers |
| `SENTRY_DSN_CLIENT` | 🟡 | Vercel | Pending Sentry project creation `nexus-web` (org `board-infinity-se`) |
| `SENTRY_DSN_SERVER` | 🟡 | Vercel | Pending Sentry project creation `nexus-api` |
| `SENTRY_AUTH_TOKEN` | 🟡 | Vercel (build env only) | For source-map upload at build time |
| `UPSTASH_REDIS_REST_URL` | 🟡 | Vercel | Pending Upstash setup (per Norm 8 rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | 🟡 | Vercel | Pending Upstash setup |
| `RESEND_API_KEY` | ⚪ | Vercel | Legacy fallback inside `api/lib/mailer.ts` |
| `GITHUB_TOKEN` | ⚪ | Local only | Agent push workflow via gh api |

> 🟡 = scheduled to add as part of the May 17 norms rollout.

---

## Infra plan (current state)

| Service | Plan | Notes |
|---|---|---|
| **Vercel** | **Pro** | `maxDuration: 300` on all functions. Preview Deployments enabled (per Norm 11). Apex `boardinfinity.com` claimed by another team — blocks www.nexus subdomain from personal account; using `nexus.boardinfinity.com` via team workspace. |
| **Supabase** | **Pro + Medium compute** | ~$60/mo Medium upgrade after Nano IO budget exhausted during UOWD demo (2026-05-15). Database Branches enabled (per Norm 11). PITR enabled (per Norm 7). HIBP password breach check enabled (per Norm 4). Region: `aws-0-ap-south-1` (Mumbai). Project ID `jlgstbucwawuntatrgvy`. |
| **Apify** | Personal Scale | $199/mo, $0.16/CU. 4 actors: LinkedIn Jobs, Google Jobs, Bayt, NaukriGulf. |
| **Mandrill** | Free tier | 500 sends/day cap. Alert at 80% (per Norm 3). |
| **Sentry** | Free → Team | Org `board-infinity-se`. Free tier sufficient to start; upgrade to Team (~$26/mo) when error volume justifies. Existing projects don't include nexus — create `nexus-web` + `nexus-api`. |
| **Upstash Redis** | Free tier | 10K commands/day free. Pay-as-you-go beyond. Rate limiting per Norm 8. |
| **GitHub** | — | Canonical: `boardinfinity/nexus`. Mirror (read-only for agents): `abhay-boardi/nexus`. **All pushes go to boardinfinity.** |

---

## Caps + budgets to watch (Norm 3)

| Service | Cap / threshold | Where to check | Alert at |
|---|---|---|---|
| Mandrill | 500 sends/day | Mandrill dashboard | 80% |
| Apify | Scale plan compute units | `/v2/users/me/limits` before big runs | 70% monthly |
| OpenAI | Monthly budget (TBD) | Platform usage | 70% monthly |
| Anthropic | Monthly budget (TBD) | Console usage | 70% monthly |
| OpenAI Batch API | 50% off real-time | n/a — used for JD pipeline at scale | — |
| Vercel function duration | 300s hard cap | Vercel logs | any function ≥200s |
| Vercel bandwidth | Pro plan included | Vercel dashboard | 70% |
| Vercel function invocations | Pro plan included | Vercel dashboard | 70% |
| Supabase compute IO | Medium tier | Supabase dashboard → reports | 70% sustained |
| Supabase DB size | Pro plan (8 GB included) | Supabase dashboard | 70% |
| Supabase advisor lints | 0 ERROR, ≤1 WARN | `get_advisors security` | any new ERROR or WARN |
| Postgres slow queries | <500 ms p95 | Supabase logs / pg_stat_statements | any >500 ms |
| Upstash Redis | 10K commands/day free | Upstash dashboard | 70% sustained |
| Sentry quota | Free tier ~5K errors/month | Sentry dashboard | 70% |

---

## Adding a new env var

1. Add to Vercel **Production AND Preview** at the same time.
2. Add to this file with required/optional + notes.
3. Update `/docs/STATUS.md`.
4. If it's an external service, add to the curated links + cost notes.
5. Never log the value. Never hardcode (per Norm 4).
