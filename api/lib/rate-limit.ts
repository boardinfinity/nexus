// Upstash Redis rate limiter with two-mode operation.
//
// Modes (controlled by RATE_LIMIT_MODE env var):
//   - "log_only" (default while baselining): never rejects; logs limit hits.
//   - "enforce": returns true when limit exceeded so caller can 429.
//
// Buckets:
//   - public: 60 req/min/IP   (placeintel, surveys, public-college-dashboard)
//   - admin : 600 req/min/IP  (everything behind verifyAuth)
//   - write : 10 req/min/IP   (mutating placeintel/survey writes)
//
// Safe-by-default: if Upstash env vars are missing, this module is a no-op
// (returns notLimited for everything).  Vercel functions in different regions
// share the same Mumbai Upstash primary, so latency is <10ms in ap-south-1.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Bucket = "public" | "admin" | "write";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const mode = (process.env.RATE_LIMIT_MODE || "log_only").toLowerCase();

let limiters: Record<Bucket, Ratelimit> | null = null;

if (url && token) {
  const redis = new Redis({ url, token });
  limiters = {
    public: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      analytics: true,
      prefix: "rl:nexus:public",
    }),
    admin: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(600, "60 s"),
      analytics: true,
      prefix: "rl:nexus:admin",
    }),
    write: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      analytics: true,
      prefix: "rl:nexus:write",
    }),
  };
}

export interface RateLimitDecision {
  /** True if the caller should block (only honoured in enforce mode). */
  shouldBlock: boolean;
  /** True if the underlying limiter ran. */
  ran: boolean;
  /** Raw upstream result (for headers). */
  remaining?: number;
  limit?: number;
  reset?: number;
}

export async function checkRateLimit(
  bucket: Bucket,
  identifier: string,
): Promise<RateLimitDecision> {
  if (!limiters) {
    return { shouldBlock: false, ran: false };
  }

  try {
    const r = await limiters[bucket].limit(identifier);
    if (!r.success) {
      // Always log — observability across both modes.
      console.warn(
        `[rate-limit][${mode}] bucket=${bucket} id=${identifier} limit=${r.limit} remaining=${r.remaining}`,
      );
      return {
        shouldBlock: mode === "enforce",
        ran: true,
        remaining: r.remaining,
        limit: r.limit,
        reset: r.reset,
      };
    }
    return {
      shouldBlock: false,
      ran: true,
      remaining: r.remaining,
      limit: r.limit,
      reset: r.reset,
    };
  } catch (err) {
    // Never fail open with a thrown error — log and let traffic through.
    console.error("[rate-limit] limiter error", err);
    return { shouldBlock: false, ran: false };
  }
}

export function getClientId(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (first) return first.split(",")[0]!.trim();
  const real = headers["x-real-ip"];
  if (typeof real === "string") return real;
  return "anon";
}

export function getBucketForPath(path: string, isAuthed: boolean): Bucket {
  // Mutating public endpoints get the tightest bucket.
  if (
    (path.startsWith("/placeintel/") || path.startsWith("/survey/")) &&
    !isAuthed
  ) {
    return "write"; // tightest — public mutators
  }
  if (path.startsWith("/public/")) return "public";
  if (path.startsWith("/placeintel/")) return "public";
  if (path.startsWith("/survey/")) return "public";
  return "admin";
}
