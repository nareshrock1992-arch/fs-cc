/**
 * Baseline security headers for the JSON API (SEC-6). Dependency-free equivalent of
 * the helmet defaults that matter for an API that never serves HTML:
 *  - nosniff: browsers must not reinterpret JSON as script/HTML
 *  - frame-ancestors/X-Frame-Options: API responses cannot be framed (clickjacking)
 *  - CSP default-src 'none': nothing in an API response may load or execute
 *  - no referrer, no cross-origin opener sharing
 * The admin portal and agent desktop pages are served by Vite/Nginx, not by this app,
 * so these headers do not affect their own CSP.
 */
export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
  });
  next();
}

/** Largest accepted JSON body. Biggest legitimate payloads are agent/queue forms (< 10 kB). */
export const JSON_BODY_LIMIT = '100kb';
