# Observability — Sentry

Wired May 17, 2026. Owner: Abhay.

## What's wired

Two Sentry projects under org `board-infinity-se`:

| Project | SDK | Init location |
|---|---|---|
| `nexus-web` | `@sentry/react` | `client/src/main.tsx` |
| `nexus-api` | `@sentry/node` | `api/lib/sentry.ts` (called from `api/index.ts`) |

Both are guarded by env vars (`VITE_SENTRY_DSN` / `SENTRY_DSN`) so the SDK is a no-op when the var is unset (e.g., on local dev machines that don't have it).

## Env vars (Production + Preview, both)

| Var | Project | Notes |
|---|---|---|
| `VITE_SENTRY_DSN` | nexus-web | Browser DSN, exposed to the bundle (this is expected — DSNs are public-safe). |
| `SENTRY_DSN` | nexus-api | Server DSN, never sent to the client. |
| `SENTRY_AUTH_TOKEN` | both | Used for source-map upload during build (future). Org-scoped token. |

`VERCEL_GIT_COMMIT_SHA` is read automatically by both SDKs to tag releases — no extra var needed.

## Sample rates

- `tracesSampleRate: 0.1` on both — captures 10% of transactions for perf monitoring.
- Crank to 1.0 only when actively debugging.

## PII posture

- `sendDefaultPii: false` on both.
- Server side attaches `Sentry.setUser({ id })` only for authenticated requests — no email/name.
- Public routes (placeintel, surveys, public college dashboard) capture errors WITHOUT user context.

## Where exceptions are captured

Server (`api/index.ts`):
- Every route-level try/catch already in the file now calls `Sentry.captureException(err, { tags: { route } })`.
- Tags let you filter in Sentry: `route:placeintel`, `route:survey`, `route:public-college-dashboard`, etc.

Client:
- `@sentry/react` auto-captures unhandled errors and promise rejections globally.

## Alert frequency

Default: "high priority issues". To change to "every new issue":
- nexus-web: https://board-infinity-se.sentry.io/settings/projects/nexus-web/alerts/
- nexus-api: https://board-infinity-se.sentry.io/settings/projects/nexus-api/alerts/

## Rotation

Auth token is org-scoped. Rotate at https://board-infinity-se.sentry.io/settings/auth-tokens/ if it leaks. DSNs are designed to be public — no rotation needed unless abuse is detected.
