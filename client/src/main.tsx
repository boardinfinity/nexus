import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Sentry browser init — guarded by VITE_SENTRY_DSN so it's a no-op locally.
// Release tagged with the Vercel commit SHA when available so issues map back
// to a specific deploy.  See /docs/OBSERVABILITY.md.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta.env.VITE_VERCEL_ENV as string) || import.meta.env.MODE,
    tracesSampleRate: 0.1,
    release: (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string) || undefined,
    // Avoid sending PII by default.
    sendDefaultPii: false,
  });
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
