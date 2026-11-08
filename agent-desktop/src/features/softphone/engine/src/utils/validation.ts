/** Input validation. Everything typed by the user passes through here before reaching SIP.js. */

export const EXTENSION_PATTERN = /^[0-9]{2,15}$/;
export const DIAL_PATTERN = /^[0-9*#+]{1,32}$/;
export const DTMF_PATTERN = /^[0-9*#A-Da-d]$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateExtension(value: string): ValidationResult {
  return EXTENSION_PATTERN.test(value)
    ? { ok: true }
    : { ok: false, message: 'Extension must be 2–15 digits.' };
}

export function validatePassword(value: string): ValidationResult {
  if (value.length === 0) return { ok: false, message: 'Password is required.' };
  if (value.length > 128) return { ok: false, message: 'Password is too long.' };
  return { ok: true };
}

export function validateDomain(value: string): ValidationResult {
  // All-numeric dotted values must be a real IPv4 address (e.g. 999.1.1.1 is refused).
  const ok = /^[\d.]+$/.test(value) ? IPV4_PATTERN.test(value) : DOMAIN_PATTERN.test(value);
  return ok ? { ok: true } : { ok: false, message: 'Domain must be an IPv4 address or host name.' };
}

/** Only secure WebSockets are allowed – plain ws:// is refused (no insecure workaround). */
export function validateWssUrl(value: string): ValidationResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'WSS URL is not a valid URL.' };
  }
  if (url.protocol !== 'wss:') {
    return { ok: false, message: 'WSS URL must start with wss:// (encrypted).' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'WSS URL must not contain credentials.' };
  }
  return { ok: true };
}

/** Strips visual separators people commonly type, then validates. */
export function normaliseDialString(value: string): string | undefined {
  const cleaned = value.replace(/[\s\-().]/g, '');
  return DIAL_PATTERN.test(cleaned) ? cleaned : undefined;
}

export function isDtmfTone(value: string): boolean {
  return DTMF_PATTERN.test(value);
}
