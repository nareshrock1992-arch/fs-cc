/**
 * Single source of truth for all runtime configuration.
 *
 * Every backend module imports from here instead of reading
 * process.env directly. This means:
 *   - One place to audit what the app needs
 *   - Defaults that make local dev work with zero config changes
 *   - No accidental hardcoded IPs anywhere else in the codebase
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';

export const config = {
  env:  process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),

  cors: {
    // Comma-separated list of allowed origins.
    // Dev:  http://localhost:5173 (admin UI) + http://localhost:8080 (agent desktop)
    // Prod: http://<SERVER_IP>:8000,http://<SERVER_IP>:8080
    // cors() and Socket.IO both accept a string array.
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:8080'],
  },

  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME     || 'fs_cc',
    user:     process.env.DB_USER     || 'fs_cc',
    password: process.env.DB_PASSWORD || 'changeme',
    max:      Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis:       30_000,
  },

  esl: {
    host:        process.env.FS_ESL_HOST            || 'localhost',
    port:        Number(process.env.FS_ESL_PORT     || 8021),
    password:    process.env.FS_ESL_PASSWORD        || 'ClueCon',
    reconnectMs: Number(process.env.FS_ESL_RECONNECT_MS || 3000),
  },

  jwt: {
    // MUST be overridden in production via JWT_SECRET env var.
    secret: process.env.JWT_SECRET || 'insecure-dev-secret-CHANGE-IN-PRODUCTION',
  },

  fs: {
    // Path to FreeSWITCH conf directory (e.g. /etc/freeswitch).
    // Used by queueXml.js to write callcenter.conf.xml.
    // Leave unset to skip file write (XML still generated in memory).
    confPath: process.env.FS_CONF_PATH || null,

    // SIP domain / IP of the FreeSWITCH internal profile.
    // Used to build agent contact strings for internal (user/ext@domain) endpoints.
    // Production value supplied by fs-cp deploy/.env SIP_DOMAIN → FS_SIP_DOMAIN.
    // Dev value: the IP of the FreeSWITCH server's internal SIP profile.
    sipDomain: process.env.FS_SIP_DOMAIN || '',
  },

  // Business/reporting timezone — the ONLY thing that defines business-day
  // (calendar) boundaries for reports, dashboards and history. It is deliberately
  // decoupled from the container tz, the Node process tz, the PostgreSQL session
  // tz, the FreeSWITCH host tz and the browser tz — none of those affect business
  // correctness. Must be a valid IANA name (e.g. Asia/Riyadh, Asia/Kolkata, UTC).
  // There is NO default and NO country-specific value baked in: it must be supplied
  // by the deployment (fs-cp) and is validated at startup (see assertBusinessTimezone).
  businessTimezone: process.env.BUSINESS_TIMEZONE || null,

  // Customer telephony mode (CP3). One FS-CC installation = one customer, so this
  // is deployment configuration like BUSINESS_TIMEZONE, not a database setting.
  //   EXTERNAL_PBX      — Avaya/Cisco/other PBX desk phones; browser phone prohibited.
  //   FREESWITCH_WEBRTC — FreeSWITCH browser softphones (per-agent enable).
  //   HYBRID            — desk phones and browser softphones side by side (per-agent enable).
  // Default EXTERNAL_PBX keeps every existing installation exactly as before.
  telephony: {
    mode: (process.env.TELEPHONY_MODE || 'EXTERNAL_PBX').trim().toUpperCase(),
    // Upstream FreeSWITCH WSS for the backend SIP relay (CP3-C). Required in WebRTC modes.
    relayUpstreamUrl: (process.env.SIP_RELAY_UPSTREAM_URL || '').trim(),
    ticketTtlMs:      Number(process.env.WEBRTC_TICKET_TTL_MS || 30_000),
    graceMs:          Number(process.env.WEBRTC_GRACE_MS || 15_000),
    // Relay → FreeSWITCH TLS (CP3-C). Optional extra CA (PEM) to trust the
    // FreeSWITCH WSS certificate; certificate checks are never disabled in production.
    relayCaFile:      (process.env.SIP_RELAY_CA_FILE || '').trim() || null,
    relayTlsInsecure: process.env.SIP_RELAY_TLS_INSECURE === 'true',
    relayMaxConnections: Number(process.env.SIP_RELAY_MAX_CONNECTIONS || 500),
  },
};

export const TELEPHONY_MODES = ['EXTERNAL_PBX', 'FREESWITCH_WEBRTC', 'HYBRID'];

// Returns a list of configuration problems (empty = valid). Pure, for tests.
export function telephonyConfigErrors(t = config.telephony, env = config.env) {
  const errors = [];
  if (!TELEPHONY_MODES.includes(t.mode)) {
    errors.push(`TELEPHONY_MODE="${t.mode}" is invalid. Use one of: ${TELEPHONY_MODES.join(', ')}.`);
    return errors;
  }
  if (t.mode !== 'EXTERNAL_PBX') {
    if (!t.relayUpstreamUrl) {
      errors.push(`SIP_RELAY_UPSTREAM_URL is required when TELEPHONY_MODE=${t.mode} (the FreeSWITCH WSS address, e.g. wss://<freeswitch-host>:7443).`);
    } else if (!/^wss?:\/\//i.test(t.relayUpstreamUrl)) {
      errors.push('SIP_RELAY_UPSTREAM_URL must start with wss:// (or ws:// for a lab).');
    }
  }
  if (!Number.isInteger(t.ticketTtlMs) || t.ticketTtlMs < 5_000 || t.ticketTtlMs > 120_000) {
    errors.push('WEBRTC_TICKET_TTL_MS must be an integer between 5000 and 120000.');
  }
  if (!Number.isInteger(t.graceMs) || t.graceMs < 5_000 || t.graceMs > 300_000) {
    errors.push('WEBRTC_GRACE_MS must be an integer between 5000 and 300000.');
  }
  if (t.relayMaxConnections !== undefined
      && (!Number.isInteger(t.relayMaxConnections) || t.relayMaxConnections < 1 || t.relayMaxConnections > 10_000)) {
    errors.push('SIP_RELAY_MAX_CONNECTIONS must be an integer between 1 and 10000.');
  }
  if (t.relayTlsInsecure && env === 'production') {
    errors.push('SIP_RELAY_TLS_INSECURE=true is not allowed in production. Use SIP_RELAY_CA_FILE to trust the FreeSWITCH certificate.');
  }
  if (t.relayCaFile && t.mode !== 'EXTERNAL_PBX') {
    try { readFileSync(t.relayCaFile); } catch { errors.push(`SIP_RELAY_CA_FILE "${t.relayCaFile}" cannot be read.`); }
  }
  return errors;
}

// Fail-fast startup guard, same style as assertBusinessTimezone().
export function assertTelephonyConfig() {
  const errors = telephonyConfigErrors();
  if (errors.length) {
    errors.forEach((e) => console.error(`[config] FATAL: ${e}`));
    console.error('[config] Refusing to start.');
    process.exit(1);
  }
  console.log(`[config] telephony mode: ${config.telephony.mode}`);
}

// True if `tz` is a valid IANA timezone name accepted by the Intl engine.
export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Fail-fast guard invoked from server startup. BUSINESS_TIMEZONE is REQUIRED and
// must be a valid IANA timezone. We never silently fall back to UTC, the host, the
// container, the PostgreSQL session tz, or a developer machine tz — a wrong business
// timezone silently corrupts every business-day report, so we refuse to start.
export function assertBusinessTimezone() {
  if (!config.businessTimezone) {
    console.error('[config] FATAL: BUSINESS_TIMEZONE is required. Set it to a valid IANA timezone (e.g. Asia/Riyadh, Asia/Kolkata, UTC). Refusing to start.');
    process.exit(1);
  }
  if (!isValidTimeZone(config.businessTimezone)) {
    console.error(`[config] FATAL: BUSINESS_TIMEZONE="${config.businessTimezone}" is not a valid IANA timezone name. Refusing to start.`);
    process.exit(1);
  }
  console.log(`[config] business timezone: ${config.businessTimezone}`);
}

// Warn loudly if running in production with obvious insecure defaults
if (config.env === 'production') {
  if (config.jwt.secret.includes('CHANGE-IN-PRODUCTION')) {
    console.error('[config] FATAL: JWT_SECRET is not set. Set it in your .env file.');
    process.exit(1);
  }
  if (config.db.password === 'changeme') {
    console.warn('[config] WARNING: DB_PASSWORD is still "changeme". Change it in production.');
  }
}
