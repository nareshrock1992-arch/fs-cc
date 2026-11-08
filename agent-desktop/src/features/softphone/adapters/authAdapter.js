/**
 * authAdapter — Phase 2 stub.
 *
 * Phase 4 (decision Q15) replaces this with: fetch a single-use relay ticket using the
 * agent JWT, and return a WSS URL for the FS-CC relay. Until then the configured
 * WSS URL is used unchanged. No network calls are made here.
 */
export async function resolveWssUrl(config) {
  return config?.defaultWssUrl ?? null;
}
