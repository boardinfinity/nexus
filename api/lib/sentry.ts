// Sentry server initialization for Vercel serverless functions.
// Safe to import even when SENTRY_DSN is unset — init becomes a no-op.
//
// Why a module-level init?  Vercel functions warm-start a Node process and
// reuse the module across invocations, so initialising once at module load
// is the cheapest correct path.  See /docs/OBSERVABILITY.md.
import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op if not configured

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    // Lower than the default 1.0 — we only need a sample of transactions.
    tracesSampleRate: 0.1,
    // Capture all unhandled errors and rejections.
    integrations: [],
    // Disable PII to stay within GDPR posture; explicit captures may add user.
    sendDefaultPii: false,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });

  initialized = true;
}

export { Sentry };
