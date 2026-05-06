# Nexus — Environment Variables

All env vars live in Vercel (Production + Preview) unless noted. Update both environments together.

| Variable | Required | Where | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | Vercel | Project `jlgstbucwawuntatrgvy` |
| `SUPABASE_ANON_KEY` | ✅ | Vercel | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Vercel | Server-side only |
| `APIFY_API_KEY` | ✅ | Vercel | Personal Scale plan, $199/mo, $0.16/CU |
| `OPENAI_API_KEY` | ✅ | Vercel | Used by JD Analyzer + Batch API |
| `ANTHROPIC_API_KEY` | ✅ | Vercel | Used by Survey AI wizard (Claude Sonnet 4.6) |
| `MANDRILL_API_KEY` | ✅ | Vercel | Replaced Resend |
| `MANDRILL_FROM_EMAIL` | ✅ | Vercel | `surveys@boardinfinity.com` (must be Mandrill-verified) |
| `MANDRILL_FROM_NAME` | ✅ | Vercel | `Board Infinity Surveys` |
| `JWT_SECRET` | ✅ | Vercel | Survey OTP / per-slug token signing |
| `RESEND_API_KEY` | ⚪ | Vercel | Legacy fallback inside `api/lib/mailer.ts` |
| `GITHUB_TOKEN` | ⚪ | Local only | For agent push workflow via gh api |

---

## Caps + budgets to watch

- **Mandrill**: 500 sends/day. Alert at 80%. Used for: OTP codes, survey invites, reminders.
- **Apify**: Scale plan compute; check `/v2/users/me/limits` before big runs.
- **OpenAI Batch API**: 50% off real-time. Used for JD pipeline at scale.
- **Vercel**: Pro plan; 300s function timeout. 1 schedule per cron tick due to this.

---

## Adding a new env var

1. Add to Vercel Production AND Preview at the same time.
2. Add to this file with required/optional + notes.
3. Update `/docs/STATUS.md`.
4. If it's an external service, add to the curated links + cost notes.
