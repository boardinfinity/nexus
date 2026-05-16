# Rate Limiting — Upstash Redis (Mumbai)

Wired May 17, 2026. Owner: Abhay.

## What's wired

- Provider: Upstash Redis (Free tier), DB `divine-katydid-126841`, Primary Region: **Mumbai** (ap-south-1).
- SDK: `@upstash/ratelimit` (sliding window) with `@upstash/redis` (REST client).
- Module: `api/lib/rate-limit.ts`.
- Wired in: top of `api/index.ts`, before route dispatch.

## Operating modes

Controlled by `RATE_LIMIT_MODE`:

| Mode | Behaviour |
|---|---|
| `log_only` (current) | Counts every request; logs to stdout when a bucket exceeds its limit; **never rejects**. |
| `enforce` | Same counting + logging, but returns `429 Too Many Requests` with `X-RateLimit-*` headers when exceeded. |

Plan: stay in `log_only` for ≥7 days, review logs/Upstash analytics, then flip to `enforce`.

## Buckets

| Bucket | Limit | Applied to |
|---|---|---|
| `public` | 60 req / 60 s / IP | `/public/*`, `/placeintel/*` (read), `/survey/*` (read) |
| `admin` | 600 req / 60 s / IP | Everything behind `verifyAuth` |
| `write` | 10 req / 60 s / IP | Public mutations on placeintel / survey (currently classified by route, refine later) |

IP source: first hop of `x-forwarded-for`, else `x-real-ip`, else literal `"anon"` (covers internal cron).

## Env vars (Production + Preview, both)

| Var | Notes |
|---|---|
| `UPSTASH_REDIS_REST_URL` | `https://divine-katydid-126841.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | RW token. Rotate if leaked. |
| `RATE_LIMIT_MODE` | `log_only` for now → flip to `enforce` after baselining. |

`UPSTASH_REDIS_REST_READONLY_TOKEN` is **not used** by the runtime — keep it as a break-glass credential for analytics queries.

## Safe-by-default

If `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is missing, the limiter is a no-op — every call returns "not limited". This prevents misconfiguration from taking the site down.

A limiter error (network, Upstash outage) is logged via `console.error` and traffic flows. Sentry will catch it.

## Excluded paths

- `/scheduler/tick` — Vercel internal cron, header-authenticated, bypasses rate limit.
- OPTIONS preflight — returns early before rate-limit check.

## Cost

Free tier: 10,000 commands/day. Each request = 1 command (sliding window single op). At current public load (~3,000/day across surveys + placeintel + public dashboards), we're well below the cap. If we breach it consistently, upgrade to Pay-as-you-go ($0.20 / 100k commands).

## Rotation

Rotate the RW token at https://console.upstash.com/ → divine-katydid-126841 → Details → Reset Token. Then update Vercel env var and redeploy.
