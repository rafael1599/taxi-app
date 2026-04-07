import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry error monitoring.
 * Called once at server startup before routes are registered.
 * No-ops when SENTRY_DSN is not set (local / CI environments).
 */
export function initSentry(release?: string) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    ...(release !== undefined ? { release } : {}),
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
}

/** Capture an unexpected error and forward to Sentry. */
export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context);
      Sentry.captureException(err);
    });
  }
}
