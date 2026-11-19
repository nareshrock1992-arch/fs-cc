import express from 'express';
import http    from 'http';
import cors    from 'cors';
import morgan  from 'morgan';

import { config, assertBusinessTimezone, assertTelephonyConfig } from './config/index.js';
import { connectESL, isConnected } from './services/eslService.js';
import { requireAuth } from './middleware/auth.js';
import { warmPool, pool, query } from './db/pool.js';
import { runMigrations }   from './db/migrationRunner.js';
import { securityHeaders, JSON_BODY_LIMIT } from './middleware/securityHeaders.js';
import { initSipRelay, RELAY_PATH } from './services/sipRelayService.js';
import { getTicketStore } from './services/relayTicketStore.js';
import { createPhonePresence, makeApplyPhoneOffline, setPhonePresence } from './services/phonePresenceService.js';
import { initSocket, getIO, SUBSCRIBERS } from './services/socketService.js';
import { ccEvents, cc } from './services/eslService.js';
import * as agentSession from './services/agentSessionService.js';

import authRoutes      from './routes/auth.js';
import usersRoutes     from './routes/users.js';
import agentsRoutes    from './routes/agents.js';
import queuesRoutes    from './routes/queues.js';
import callsRoutes     from './routes/calls.js';
import statsRoutes     from './routes/stats.js';
import reportsRoutes   from './routes/reports.js';
import breakCodesRoutes from './routes/breakCodes.js';
import agentDeskRoutes from './routes/agentDesk.js';

const app    = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors({ origin: config.cors.origin }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ── Health check (public) ─────────────────────────────────────────────────────
// Liveness — process is up (no dependency checks).
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), env: config.env })
);

// Readiness — verifies the critical dependency (PostgreSQL) is actually
// reachable, plus reports ESL connectivity. Returns 503 when the DB is down so
// an orchestrator/health probe does not treat a DB-less backend as healthy.
// Exposes no secrets — only boolean dependency status.
app.get('/api/health/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true, esl: isConnected() });
  } catch {
    res.status(503).json({ ok: false, db: false, esl: isConnected() });
  }
});

// ── Agent Desktop (public login + agent-authenticated endpoints) ──────────────
app.use('/api/agent-desk', agentDeskRoutes);

// ── Admin API (requires admin JWT) ───────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/users',   usersRoutes);
app.use('/api/agents',  agentsRoutes);
app.use('/api/queues',  queuesRoutes);
app.use('/api/calls',   callsRoutes);
app.use('/api/stats',   statsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/break-codes', breakCodesRoutes);

// Customer telephony mode (CP3) — read-only, lets the admin UI show or hide the
// per-agent browser-phone setting. Admin JWT required (requireAuth above).
app.get('/api/telephony/config', (_req, res) =>
  res.json({ mode: config.telephony.mode, webrtc_available: config.telephony.mode !== 'EXTERNAL_PBX' })
);

// Queue XML export / preview routes live in routes/queues.js (BUG-005: they must be
// registered before /:queueName, otherwise preview-xml is read as a queue name).

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error('[api]', err.message || err);
  // Never leak internal (e.g. raw SQL/driver) error text to clients on a 5xx in
  // production; intentional 4xx messages (validation/not-found/conflict) are
  // still surfaced so clients get actionable feedback.
  const clientMessage = (status >= 500 && config.env === 'production')
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({ error: clientMessage });
});

initSocket(server, config.cors.origin);

// ── Browser-phone SIP relay (CP3-C) ───────────────────────────────────────────
// Attached ONLY when the customer mode allows WebRTC. For EXTERNAL_PBX no relay
// exists: the /api/sip-relay upgrade path is not handled by anything.
const sipRelay = initSipRelay({
  server,
  config,
  ticketStore: getTicketStore(config.telephony.ticketTtlMs),
  loadAgent: async (agentId) => {
    const { rows } = await query(
      `SELECT agent_id, agent_type, webrtc_enabled, active, contact FROM agents WHERE agent_id = $1`,
      [agentId]
    );
    return rows[0] || null;
  },
});
if (sipRelay) console.log(`[sip-relay] enabled on ${RELAY_PATH} (mode ${config.telephony.mode})`);

// ── Browser-phone presence + PHONE_OFFLINE (CP3-D) ─────────────────────────────
// Uses the relay lifecycle events and the existing ESL agent-state events. New
// Socket.IO events are sent through the existing getIO() — socketService.js is
// unchanged: 'agent:phone' to the agent's room and all authenticated clients,
// 'agent:webrtc-changed' to the agent's room only.
const PHONE_AGENT_SQL =
  `SELECT agent_id, agent_type, webrtc_enabled, active, contact, status, state FROM agents`;
let phonePresence = null;
if (sipRelay) {
  phonePresence = createPhonePresence({
    getMode: () => config.telephony.mode,
    graceMs: config.telephony.graceMs,
    relay: sipRelay,
    loadAgent: async (agentId) => (await query(`${PHONE_AGENT_SQL} WHERE agent_id = $1`, [agentId])).rows[0] || null,
    applyPhoneOffline: makeApplyPhoneOffline({ query, cc, agentSession, ccEvents }),
    emit: (event, agentId, payload) => {
      try {
        const io = getIO();
        io.to(`agent:${agentId}`).emit(event, payload);
        if (event === 'agent:phone') io.to(SUBSCRIBERS).emit(event, payload);
      } catch { /* Socket.IO not ready */ }
    },
  });
  phonePresence.attach({ relayEvents: sipRelay.events, ccEvents });
  setPhonePresence(phonePresence);
}

// Run DB setup before binding the port so no HTTP request can reach the
// application against a partially migrated schema.
async function start() {
  try {
    // Fail fast if the business/reporting timezone is missing or invalid — a wrong
    // BUSINESS_TIMEZONE silently corrupts every business-day report, so refuse to start.
    assertBusinessTimezone();
    assertTelephonyConfig();
    await warmPool();
    await runMigrations();
  } catch (err) {
    console.error('[startup] fatal — DB setup failed:', err.message);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`[server] ✓ listening on :${config.port}  env:${config.env}  cors:${config.cors.origin}`);
    connectESL();
    // After a restart nothing is restored from memory: logged-in browser-phone
    // agents must re-register (with a fresh ticket) within the startup grace.
    if (phonePresence) {
      query(`${PHONE_AGENT_SQL} WHERE webrtc_enabled = true AND status IN ('Available','On Break')`)
        .then(({ rows }) => phonePresence.startupRecovery(rows))
        .catch((e) => console.error('[phone] startup recovery failed:', e.message));
    }
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On SIGTERM/SIGINT (docker stop, orchestrator drain, Ctrl-C): stop accepting
// new connections, then close the DB pool, then exit. A watchdog forces exit if
// something hangs so the container never gets stuck. Idempotent via `shuttingDown`.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down gracefully`);
  const watchdog = setTimeout(() => {
    console.error('[server] shutdown watchdog fired — forcing exit');
    process.exit(1);
  }, 10_000);
  watchdog.unref();
  try {
    // Close browser-phone relay sessions first: open WebSockets would otherwise
    // keep server.close() waiting until the watchdog fires.
    phonePresence?.stop();
    if (sipRelay) await sipRelay.close().catch((e) => console.error('[sip-relay] close error:', e.message));
    await new Promise((resolve) => server.close(resolve)); // drain in-flight HTTP
    await pool.end();                                       // close DB pool cleanly
    console.log('[server] clean shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[server] error during shutdown:', err.message);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
