/**
 * Browser-phone presence and PHONE_OFFLINE handling (CP3-D).
 *
 * Tracks each WebRTC agent's phone connectivity separately from the agent's
 * contact-center status and from call state:
 *
 *   none ──registered──► online ──session-close/unregister──► grace ──15 s──► offline
 *                          ▲                                    │               │
 *                          └──────────── registered ────────────┴───────────────┘
 *
 * - A temporary interruption (grace) never changes the agent's status.
 * - After the grace period an Available agent is put On Break with the system
 *   break code PHONE_OFFLINE — unless they are on a queue call, in which case it
 *   is applied after the call ends. Calls are never touched.
 * - Recovery clears the phone indicator only; the agent stays on break until
 *   they choose Available themselves.
 * - State is in memory. After a backend restart nothing is restored: phones must
 *   reconnect with a fresh ticket (CP3-C), and agents who do not re-register
 *   within the startup grace are treated as offline.
 */
import { effectiveWebrtc } from '../utils/telephony.js';

export const IN_CALL_STATES = new Set(['Receiving', 'In a queue call']);
export const PHONE_OFFLINE_CODE = 'PHONE_OFFLINE';
/** The answered-call state; ringing (Receiving) alone never gets a system outcome. */
const ANSWERED_STATE = 'In a queue call';

/**
 * @param {object} deps
 * @param {() => string} deps.getMode            current TELEPHONY_MODE
 * @param {number} deps.graceMs                  connection-loss grace (15 000)
 * @param {number} [deps.startupGraceMs]         grace after a backend restart (60 000)
 * @param {(agentId:string) => Promise<object|null>} deps.loadAgent  agent row incl. status, state, agent_type, webrtc_enabled, active, contact
 * @param {(agentId:string) => Promise<boolean>} deps.applyPhoneOffline  atomic Available → On Break(PHONE_OFFLINE); true if applied
 * @param {(event:string, agentId:string, payload:object) => void} [deps.emit]  push to Socket.IO
 * @param {{ closeAgent(agentId:string, reason?:string): boolean, hasSession(agentId:string): boolean }} [deps.relay]
 * @param {object} [deps.logger]
 * @param {() => number} [deps.now]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [deps.timers]
 * @param {(agentId:string, info:{lostAt:Date}) => Promise<void>} [deps.onCallDisconnected]  the phone
 *        was lost during an answered queue call and is now declared offline, and that call has ended
 *        (M1: records the SYSTEM_DISCONNECTED outcome). `lostAt` = when the phone was lost.
 *        Called once per lost phone, whether the call ended during the grace (usual: FreeSWITCH
 *        ends the call within seconds of the drop — KF-11) or after the phone was declared offline.
 */
export const RELOAD_GRACE_MS = 60_000;
export const RELOAD_COOLDOWN_MS = 5 * 60_000;

export function createPhonePresence({
  getMode, graceMs, startupGraceMs = 60_000, reloadGraceMs = RELOAD_GRACE_MS, reloadCooldownMs = RELOAD_COOLDOWN_MS,
  loadAgent, applyPhoneOffline,
  emit = () => {}, relay = null, logger = console, now = Date.now,
  timers = { setTimeout, clearTimeout }, onCallDisconnected = null,
}) {
  // agentId -> { phone, since, timer, pendingOffline, pendingClose,
  //              inCall, lostAt, callEndedInGrace, outcomeOnCallEnd }  (last four: M1 system outcome)
  const agents = new Map();
  const reloads = new Map(); // agentId -> { until, lastAt } — page-reload allowance (CP3-E)
  const log = (lvl, msg) => logger[lvl](`[phone] ${msg}`);

  function entry(agentId) {
    let e = agents.get(agentId);
    if (!e) {
      e = { phone: 'none', since: now(), timer: null, pendingOffline: false, pendingClose: false,
            inCall: false, lostAt: null, callEndedInGrace: false, outcomeOnCallEnd: false };
      agents.set(agentId, e);
    }
    return e;
  }

  function setPhone(agentId, e, phone) {
    if (e.phone === phone) return;
    e.phone = phone;
    e.since = now();
    emit('agent:phone', agentId, { agentId, phone, since: new Date(e.since).toISOString() });
  }

  function clearTimer(e) {
    if (e.timer) { timers.clearTimeout(e.timer); e.timer = null; }
  }

  function startGrace(agentId, ms, why) {
    const e = entry(agentId);
    if (e.phone === 'offline') return;          // already offline; nothing to wait for
    if (e.phone === 'grace' && e.timer) return; // flapping must not extend the grace
    setPhone(agentId, e, 'grace');
    e.lostAt = e.since;
    e.callEndedInGrace = false;
    clearTimer(e);
    e.timer = timers.setTimeout(() => { e.timer = null; evaluate(agentId).catch((err) => log('error', `evaluate ${agentId}: ${err.message}`)); }, ms);
    log('info', `${agentId} phone lost (${why}); grace ${Math.round(ms / 1000)} s`);
  }

  /** Grace expired: decide what happens to the agent. */
  async function evaluate(agentId) {
    const e = agents.get(agentId);
    if (!e || e.phone !== 'grace') return;
    const agent = await loadAgent(agentId);
    if (!agents.has(agentId) || e.phone !== 'grace') return; // logged out / recovered meanwhile
    if (!effectiveWebrtc(agent, getMode()).allowed) {
      log('info', `${agentId} no longer allowed the browser phone; presence cleared, no PHONE_OFFLINE`);
      clearTimer(e); agents.delete(agentId);
      return;
    }
    setPhone(agentId, e, 'offline');
    // M1 system outcome (KF-11): the answered call already ended during the grace, or
    // is still up — then it is written when the call ends. Independent of the status.
    if (e.callEndedInGrace) { e.callEndedInGrace = false; recordOutcome(agentId, e); }
    else if (agent.state === ANSWERED_STATE) e.outcomeOnCallEnd = true;
    if (agent.status !== 'Available') {
      log('info', `${agentId} phone offline; status "${agent.status}" kept`);
      return;
    }
    if (IN_CALL_STATES.has(agent.state)) {
      e.pendingOffline = true;
      log('info', `${agentId} phone offline during a call; PHONE_OFFLINE deferred until the call ends`);
      return;
    }
    await applyOffline(agentId, e);
  }

  /** M1: hand the dropped call to the outcome writer once; it never overwrites an agent's outcome. */
  function recordOutcome(agentId, e) {
    e.outcomeOnCallEnd = false;
    if (!onCallDisconnected) return;
    const lostAt = new Date(e.lostAt ?? now());
    Promise.resolve(onCallDisconnected(agentId, { lostAt }))
      .catch((err) => log('error', `${agentId} system outcome: ${err.message}`));
  }

  async function applyOffline(agentId, e) {
    e.pendingOffline = false;
    const applied = await applyPhoneOffline(agentId);
    log('info', applied
      ? `${agentId} set On Break (${PHONE_OFFLINE_CODE})`
      : `${agentId} PHONE_OFFLINE not applied (status changed meanwhile)`);
  }

  // ── Relay events ─────────────────────────────────────────────────────────────
  function onRegistered({ agentId }) {
    const e = entry(agentId);
    const was = e.phone;
    clearTimer(e);
    e.pendingOffline = false;
    e.callEndedInGrace = false;   // phone back in time: the agent records the outcome
    e.outcomeOnCallEnd = false;
    setPhone(agentId, e, 'online');
    if (was === 'offline' || was === 'grace') log('info', `${agentId} phone recovered (was ${was}); agent status unchanged`);
  }

  /** Grace for a lost phone: the normal 15 s, or the one-time page-reload allowance. */
  function lossGraceMs(agentId) {
    const r = reloads.get(agentId);
    if (r && r.until > now()) { r.until = 0; return Math.max(graceMs, reloadGraceMs); }
    return graceMs;
  }

  function onLost({ agentId }, why) {
    if (relay?.hasSession(agentId)) return; // a newer session (refresh/replacement) is active
    const e = agents.get(agentId);
    if (!e || e.phone === 'none') return;   // never registered: nothing to lose
    startGrace(agentId, lossGraceMs(agentId), why);
  }

  /**
   * The Agent Desktop page is reloading (browser refresh): the agent must type
   * the SIP password again, which takes longer than 15 s. Give the NEXT phone
   * loss of this agent a one-time longer grace (default 60 s), at most once per
   * cooldown (default 5 min) so it cannot be used to avoid PHONE_OFFLINE.
   * If the phone was already lost (grace running), that grace is extended once.
   * @returns {boolean} true when the allowance was granted
   */
  function expectReload(agentId) {
    const prev = reloads.get(agentId);
    if (prev && now() - prev.lastAt < reloadCooldownMs) return false;
    reloads.set(agentId, { until: now() + reloadGraceMs, lastAt: now() });
    const e = agents.get(agentId);
    if (e && e.phone === 'grace' && e.timer) {
      clearTimer(e);
      reloads.get(agentId).until = 0;
      e.timer = timers.setTimeout(() => { e.timer = null; evaluate(agentId).catch((err) => log('error', `evaluate ${agentId}: ${err.message}`)); }, reloadGraceMs);
    }
    log('info', `${agentId} page reload: next phone loss gets ${Math.round(reloadGraceMs / 1000)} s`);
    return true;
  }

  function onUnregistered(p) {
    if (p.reason === 'session closed') return; // the matching session-close handles it
    const e = agents.get(p.agentId);
    if (!e || e.phone === 'none') return;
    startGrace(p.agentId, lossGraceMs(p.agentId), 'phone signed out');
  }

  // ── Call-state events (existing ESL ccEvents) ────────────────────────────────
  async function onAgentState({ agentId, state }) {
    const e = agents.get(agentId);
    if (!e || state == null) return;
    if (IN_CALL_STATES.has(state)) { e.inCall = state === ANSWERED_STATE || e.inCall; return; }
    const answeredCallEnded = e.inCall;
    e.inCall = false;
    if (e.pendingClose) {
      e.pendingClose = false;
      relay?.closeAgent(agentId, 'browser phone disabled');
      agents.delete(agentId);
      log('info', `${agentId} browser phone disabled after the call ended`);
      return;
    }
    // M1 system outcome. Never blocks or changes the PHONE_OFFLINE handling below.
    if (answeredCallEnded && e.phone === 'grace') e.callEndedInGrace = true; // written if the grace expires
    if (e.outcomeOnCallEnd && e.phone === 'offline') recordOutcome(agentId, e);
    if (e.pendingOffline && e.phone === 'offline') {
      const agent = await loadAgent(agentId);
      if (!e.pendingOffline || e.phone !== 'offline') return;
      if (!effectiveWebrtc(agent, getMode()).allowed || agent.status !== 'Available') { e.pendingOffline = false; return; }
      if (IN_CALL_STATES.has(agent.state)) return;
      await applyOffline(agentId, e);
    }
  }

  // ── Agent / admin actions ────────────────────────────────────────────────────
  function agentLoggedOut(agentId) {
    const e = agents.get(agentId);
    if (e) clearTimer(e);
    agents.delete(agentId);
    reloads.delete(agentId);
    relay?.closeAgent(agentId, 'agent logged out');
  }

  /** Admin changed the agent's browser-phone permission (or mode prevents it). */
  async function permissionChanged(agentId, allowed) {
    emit('agent:webrtc-changed', agentId, { agentId, allowed });
    if (allowed) return;
    const e = entry(agentId);
    clearTimer(e);
    e.pendingOffline = false;
    const agent = await loadAgent(agentId);
    if (agent && IN_CALL_STATES.has(agent.state)) {
      e.pendingClose = true; // never cut an active call
      log('info', `${agentId} browser phone disabled; will close after the current call`);
      return;
    }
    relay?.closeAgent(agentId, 'browser phone disabled');
    agents.delete(agentId);
  }

  /** After a backend restart: logged-in WebRTC agents must re-register in time. */
  function startupRecovery(rows) {
    let n = 0;
    for (const a of rows) {
      if (!effectiveWebrtc(a, getMode()).allowed) continue;
      if (a.status !== 'Available' && a.status !== 'On Break') continue;
      const e = entry(a.agent_id);
      e.phone = 'online'; // assumed connected before the restart
      startGrace(a.agent_id, startupGraceMs, 'backend restart');
      n++;
    }
    if (n) log('info', `startup: waiting up to ${Math.round(startupGraceMs / 1000)} s for ${n} browser phone(s) to re-register`);
    return n;
  }

  function attach({ relayEvents, ccEvents }) {
    relayEvents?.on('registered', onRegistered);
    relayEvents?.on('session-close', (p) => onLost(p, 'connection closed'));
    relayEvents?.on('unregistered', onUnregistered);
    ccEvents?.on('agent:state', (p) => { onAgentState(p).catch((err) => log('error', `agent:state ${p?.agentId}: ${err.message}`)); });
  }

  return {
    attach, onRegistered, onLost, onUnregistered, onAgentState, evaluate, expectReload,
    agentLoggedOut, permissionChanged, startupRecovery,
    getPhoneStatus: (agentId) => agents.get(agentId)?.phone ?? 'none',
    /** True when the agent has phone presence or a live relay session. */
    isTracked: (agentId) => agents.has(agentId) || Boolean(relay?.hasSession(agentId)),
    isPending: (agentId) => ({ offline: !!agents.get(agentId)?.pendingOffline, close: !!agents.get(agentId)?.pendingClose }),
    stop: () => { for (const e of agents.values()) clearTimer(e); agents.clear(); reloads.clear(); },
  };
}

/**
 * Default PHONE_OFFLINE writer using the existing FS-CC status path.
 * Atomic compare-and-set (only if still Available), DB + session history first,
 * then FreeSWITCH, so FreeSWITCH's echoed status event is a same-status no-op.
 */
export function makeApplyPhoneOffline({ query, cc, agentSession, ccEvents, logger = console }) {
  return async function applyPhoneOffline(agentId) {
    const { rows } = await query(
      `UPDATE agents
          SET status = 'On Break', break_code = $2, break_started_at = now(), updated_at = now()
        WHERE agent_id = $1 AND status = 'Available'
        RETURNING agent_id`,
      [agentId, PHONE_OFFLINE_CODE]
    );
    if (!rows[0]) return false;
    const bc = await query(`SELECT name FROM break_codes WHERE code = $1`, [PHONE_OFFLINE_CODE]);
    const breakInfo = { break_code: PHONE_OFFLINE_CODE, break_name: bc.rows[0]?.name || 'Phone offline' };
    await query(
      `INSERT INTO agent_state_log (agent_id, status, reason, break_code) VALUES ($1,'On Break','phone_offline',$2)`,
      [agentId, PHONE_OFFLINE_CODE]
    );
    try { await agentSession.handleStatusTransition(agentId, 'On Break', 'phone_offline', breakInfo); }
    catch (err) { logger.error(`[phone] session transition failed for ${agentId}: ${err.message}`); }
    try { await cc.agentSetStatus(agentId, 'On Break'); }
    catch { /* ESL offline — DB is authoritative and reconciled later */ }
    ccEvents?.emit('agent:status', { agentId, status: 'On Break', break_code: PHONE_OFFLINE_CODE, break_name: breakInfo.break_name });
    return true;
  };
}

// Process-wide instance (null when the mode does not allow WebRTC).
let shared = null;
export function setPhonePresence(p) { shared = p; }
export function getPhonePresence() { return shared; }
