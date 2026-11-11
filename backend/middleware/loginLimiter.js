/**
 * Brute-force protection for the two public login endpoints
 * (admin /api/auth/login and agent /api/agent-desk/login — agent PINs are short).
 *
 * Counts FAILED attempts (HTTP 401 responses) per client IP + login name in a sliding
 * window. After `max` failures the key is blocked with HTTP 429 until the window
 * passes. A successful login (2xx) clears the key. In-memory and per process: enough
 * for the single backend instance FS-CC runs today; a shared store (e.g. Redis) is
 * needed if the backend is ever scaled horizontally.
 */
export function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000, idField = 'username', now = Date.now } = {}) {
  const failures = new Map(); // key -> array of failure timestamps

  function keyOf(req) {
    const id = String(req.body?.[idField] ?? '').trim().toLowerCase().slice(0, 64);
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}|${id}`;
  }

  function recent(key) {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) || []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  }

  function middleware(req, res, next) {
    const key = keyOf(req);
    const list = recent(key);
    if (list.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }
    res.on('finish', () => {
      if (res.statusCode === 401) failures.set(key, [...recent(key), now()]);
      else if (res.statusCode >= 200 && res.statusCode < 300) failures.delete(key);
    });
    next();
  }

  middleware.reset = () => failures.clear();
  return middleware;
}
