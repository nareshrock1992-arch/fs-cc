import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { LayoutDashboard, PhoneCall, Coffee, X, ListOrdered } from 'lucide-react';
import { api }            from '../api/client.js';
import { socket }         from '../api/socket.js';
import CurrentBreakPanel  from '../components/CurrentBreakPanel.jsx';
import CallHistory        from '../components/CallHistory.jsx';
import BreakHistory       from '../components/BreakHistory.jsx';
import QueueCard          from '../components/QueueCard.jsx';
import PerformanceCard    from '../components/PerformanceCard.jsx';
import AppShell           from '../shell/AppShell.jsx';
import StatusSelector     from '../shell/StatusSelector.jsx';
import { buildLamps }     from '../shell/ConnectionLamps.jsx';
import { Section, EmptyState } from '../ui/primitives.jsx';
import { correlate }      from '../interactions/correlate.js';
import InteractionWorkspace from '../workspace/InteractionWorkspace.jsx';
import PhoneConsole       from '../workspace/phone/PhoneConsole.jsx';
import CallStrip          from '../workspace/CallStrip.jsx';
import {
  CustomerPanel, QueueSummary, ActivityStrip, NotReachableBanner, shouldWarnNotReachable,
} from '../workspace/ContextPanels.jsx';

// ── Browser phone (WebRTC) ──────────────────────────────────────────────────
// Off unless the build sets VITE_WEBRTC_ENABLED=true. Vite replaces the env value at
// build time, so when off the softphone code (and sip.js) is not part of the build.
// PhoneBridge hands the live phone object (usePhone) to the whole desk.
const WEBRTC_ENABLED = import.meta.env.VITE_WEBRTC_ENABLED === 'true';
const PhoneBridge = WEBRTC_ENABLED
  ? lazy(() => import('../features/softphone/ui/PhoneBridge.jsx'))
  : null;

const NAV = [
  { key: 'dashboard', label: 'Workspace', Icon: LayoutDashboard },
  { key: 'queues',    label: 'Queues',    Icon: ListOrdered },
  { key: 'calls',     label: 'Calls',     Icon: PhoneCall },
  { key: 'breaks',    label: 'Breaks',    Icon: Coffee },
];
async function stopSoftphone() {
  if (!WEBRTC_ENABLED) return;
  try { await (await import('../features/softphone/index.js')).stopSoftphoneIfActive(); } catch {}
}

const QUEUE_INTERVAL = 3_000;
const PERF_INTERVAL  = 30_000;
// How long an offered (ringing) queue call is kept when /calls does not list it yet.
const OFFER_HOLD_MS  = 120_000;

export default function Dashboard({ auth, theme }) {
  const { agent, logout, updateAgent } = auth;

  const [queues,      setQueues]      = useState([]);
  const [perf,        setPerf]        = useState(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [eslConn,     setEslConn]     = useState(false);
  const [callState,   setCallState]   = useState(null);
  const [breakCodes,  setBreakCodes]  = useState([]);
  const [view,        setView]        = useState('dashboard'); // dashboard | calls | breaks
  const [toast,       setToast]       = useState(null);
  // Connectivity (display only): API reachability comes from the existing 3-s queue
  // poll; socket state from socket.io events; phone from PhoneBridge.
  const [apiOk,       setApiOk]       = useState(null);
  const [socketUp,    setSocketUp]    = useState(socket.connected);
  // This agent's recent calls (existing call-history API): list rows + distinct numbers.
  const [recentNumbers, setRecentNumbers] = useState([]);
  const [recentCalls,   setRecentCalls]   = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  // A number chosen from recent calls, loaded into the phone console display.
  const [dialRequest, setDialRequest] = useState(null);
  const fetchRecent = useCallback(async () => {
    try {
      const r = await api.callHistory({ limit: 15 });
      const rows = r?.data || [];
      const seen = [];
      for (const c of rows) {
        const n = c.direction === 'outbound' ? c.dnis : c.ani;
        // skip the agent's own extension (it can appear as dnis/ani of its own calls)
        if (n && n !== agent?.avaya_extension && !seen.includes(n)) seen.push(n);
        if (seen.length === 5) break;
      }
      setRecentNumbers(seen);
      setRecentCalls(rows.slice(0, 8));
    } catch { /* optional */ }
    finally { setRecentLoading(false); }
  }, []);
  useEffect(() => { fetchRecent(); }, [fetchRecent]);
  useEffect(() => { if (!callState) fetchRecent(); }, [callState, fetchRecent]);

  const agentId     = agent?.agent_id;
  const agentStatus = agent?.status || 'Logged Out';

  // Configured break codes (active + selectable) — source of truth for the
  // break menu, current-break thresholds, and history filters.
  const fetchBreakCodes = useCallback(async () => {
    try { setBreakCodes(await api.breakCodes()); } catch { /* keep last */ }
  }, []);
  useEffect(() => { fetchBreakCodes(); }, [fetchBreakCodes]);

  // Threshold lookup for the current break (by code) from the configured list.
  const currentBreakCfg = breakCodes.find(bc => bc.code === agent?.break_code) || null;

  // ── Queue stats polling ───────────────────────────────────────────────────
  const fetchQueues = useCallback(async () => {
    try { setQueues(await api.queues()); setApiOk(true); } catch { setApiOk(false); }
  }, []);

  // Socket connectivity for the "Live" lamp (separate listeners; the business
  // event handlers below are unchanged).
  useEffect(() => {
    const up = () => setSocketUp(true);
    const down = () => setSocketUp(false);
    socket.on('connect', up);
    socket.on('disconnect', down);
    setSocketUp(socket.connected);
    return () => { socket.off('connect', up); socket.off('disconnect', down); };
  }, []);

  useEffect(() => {
    fetchQueues();
    const id = setInterval(fetchQueues, QUEUE_INTERVAL);
    return () => clearInterval(id);
  }, [fetchQueues]);

  // ── Performance polling ───────────────────────────────────────────────────
  const fetchPerf = useCallback(async () => {
    try { setPerf(await api.performance()); }
    catch {}
    finally { setPerfLoading(false); }
  }, []);

  useEffect(() => {
    fetchPerf();
    const id = setInterval(fetchPerf, PERF_INTERVAL);
    return () => clearInterval(id);
  }, [fetchPerf]);

  // ── Active call polling (fallback) ────────────────────────────────────────
  const fetchCalls = useCallback(async () => {
    try {
      const calls  = await api.calls();
      const active = calls.find(c => !c.end_time);
      if (active) {
        setCallState(prev => {
          if (prev?.phase === 'talking' && prev.callUuid === active.call_uuid) return prev;
          return {
            phase:     active.agent_answer_time ? 'talking' : 'ringing',
            callUuid:  active.call_uuid,
            ani:       active.ani,
            caller_name: active.caller_name,
            queueName: active.queue_name,
            startedAt: active.agent_answer_time || active.queue_enter_time || active.start_time,
          };
        });
      } else {
        // calls.agent_id is only set once a call is answered, so a call that is still
        // RINGING for this agent is not in /calls. Keep a ringing state that came from the
        // agent:offering event (for up to OFFER_HOLD_MS); end events below clear it.
        setCallState(prev =>
          prev?.phase === 'ringing' && prev.offeredAt && Date.now() - prev.offeredAt < OFFER_HOLD_MS
            ? prev : null);
      }
    } catch {}
  }, []);

  // Fill in number / caller name / queue for an offered call from the existing
  // agent-scoped call-detail API (the agent_history row is written before the event).
  const enrichOffer = useCallback(async (callUuid) => {
    try {
      const d = await api.callDetail(callUuid);
      setCallState(prev => prev?.callUuid === callUuid
        ? { ...prev, ani: prev.ani || d.ani, caller_name: prev.caller_name || d.caller_name, queueName: prev.queueName || d.queue_name }
        : prev);
    } catch { /* optional enrichment */ }
  }, []);

  useEffect(() => {
    fetchCalls();
    const id = setInterval(fetchCalls, QUEUE_INTERVAL);
    return () => clearInterval(id);
  }, [fetchCalls]);

  // ── Authoritative status sync on mount ───────────────────────────────────
  // localStorage agent_info is written at login time and can be stale (e.g.
  // status='Logged Out') while the DB/FreeSWITCH already have status='Available'.
  // A single GET /api/agent-desk/me at mount corrects the snapshot without
  // polling. Failure is silent — the existing localStorage value is preserved.
  useEffect(() => {
    let mounted = true;
    api.me()
      .then(fresh => {
        if (mounted) updateAgent({
          status: fresh.status, state: fresh.state,
          break_code: fresh.break_code ?? null,
          break_name: fresh.break_name ?? null,
          break_started_at: fresh.break_started_at ?? null,
        });
      })
      .catch(err => console.warn('[agent-desktop] mount status sync failed — keeping existing status:', err.message));
    return () => { mounted = false; };
  }, [updateAgent]);

  // ── Socket.IO real-time events ────────────────────────────────────────────
  useEffect(() => {
    // Re-sync ESL status and agent status on every socket connect/reconnect.
    // The backend emits esl:status immediately on connection (socketService.js),
    // but that event can be missed if the Socket.IO transport drops during the
    // FreeSWITCH restart window. This REST call guarantees the UI reflects the
    // authoritative backend state regardless of event delivery timing.
    const onConnect = async () => {
      try {
        const { connected } = await api.eslStatus();
        setEslConn(connected);
      } catch { /* ignore — esl:status socket event is the primary path */ }
      // Re-sync agent status from DB on reconnect — guards against stale
      // localStorage after a backend restart that doesn't emit agent:status.
      try {
        const fresh = await api.me();
        updateAgent({
          status: fresh.status, state: fresh.state,
          break_code: fresh.break_code ?? null,
          break_name: fresh.break_name ?? null,
          break_started_at: fresh.break_started_at ?? null,
        });
      } catch { /* ignore — mount sync or next agent:status event will correct */ }
    };

    const onEslStatus   = ({ connected }) => setEslConn(connected);
    const onQueueUpdate = () => fetchQueues();
    // Display-only: an offered (ringing) call is cleared when its channel hangs up or
    // the caller abandons; then the existing poll re-syncs.
    const clearOffer = (uuid) =>
      setCallState(prev => (uuid && prev?.phase === 'ringing' && prev.callUuid === uuid ? null : prev));
    const onHangup      = ({ uuid } = {}) => { clearOffer(uuid); fetchCalls(); };
    const onAbandoned   = ({ callUuid } = {}) => { clearOffer(callUuid); fetchQueues(); };

    const onAgentOffering = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev =>
        prev?.callUuid === callUuid ? prev
          : { phase: 'ringing', callUuid, ani: null, queueName: null, startedAt: new Date().toISOString(), offeredAt: Date.now() }
      );
      enrichOffer(callUuid);
      fetchCalls();
    };

    const onCallBridged = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev =>
        prev?.callUuid === callUuid
          ? { ...prev, phase: 'talking', startedAt: prev.startedAt || new Date().toISOString() }
          : prev
      );
      fetchCalls();
    };

    const onCallEnd = ({ callUuid }) => {
      setCallState(prev => prev?.callUuid === callUuid ? null : prev);
      setTimeout(fetchPerf, 2000);
    };

    const onAgentNoAnswer = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev => prev?.callUuid === callUuid ? null : prev);
      setTimeout(fetchPerf, 2000);
    };

    const onAgentStatus = ({ agentId: evtAgent, status }) => {
      if (evtAgent !== agentId) return;
      // Guard: only apply status when the event carries a real value.
      // agent-status-change payloads can have status: null if the FreeSWITCH
      // header is absent; spreading null onto agent.status then causes
      // `null || 'Logged Out'` to display incorrectly.
      if (status != null) updateAgent({ status });
    };

    const onAgentState = ({ agentId: evtAgent, status, state }) => {
      if (evtAgent !== agentId) return;
      // agent-state-change events report state transitions (Waiting → Receiving →
      // In a queue call) but do NOT always include CC-Agent-Status.  When the
      // header is absent modesl returns null, and spreading { status: null } onto
      // prev.agent overwrites a valid 'Available' with null, which then renders as
      // 'Logged Out' via `agent?.status || 'Logged Out'`.
      // Fix: include each field in the patch only when the event actually provides
      // a value — identical logic to the Admin UI's `status ?? a.status` guard.
      updateAgent({
        ...(status != null && { status }),
        ...(state  != null && { state  }),
      });
    };

    socket.on('connect',         onConnect);
    // If socket is already connected when this effect runs (e.g. initial mount
    // after the connection was established), fetch current status immediately —
    // the server's connect-time esl:status emit may have arrived before this
    // listener was registered.
    if (socket.connected) onConnect();
    socket.on('esl:status',      onEslStatus);
    socket.on('agent:offering',  onAgentOffering);
    socket.on('call:bridged',    onCallBridged);
    socket.on('call:bridge-end', onCallEnd);
    socket.on('channel:hangup',  onHangup);
    socket.on('agent:no-answer', onAgentNoAnswer);
    socket.on('agent:status',    onAgentStatus);
    socket.on('agent:state',     onAgentState);
    socket.on('call:enqueued',   onQueueUpdate);
    socket.on('call:abandoned',  onAbandoned);

    return () => {
      socket.off('connect',         onConnect);
      socket.off('esl:status',      onEslStatus);
      socket.off('agent:offering',  onAgentOffering);
      socket.off('call:bridged',    onCallBridged);
      socket.off('call:bridge-end', onCallEnd);
      socket.off('channel:hangup',  onHangup);
      socket.off('agent:no-answer', onAgentNoAnswer);
      socket.off('agent:status',    onAgentStatus);
      socket.off('agent:state',     onAgentState);
      socket.off('call:enqueued',   onQueueUpdate);
      socket.off('call:abandoned',  onAbandoned);
    };
  }, [agentId, fetchQueues, fetchCalls, fetchPerf, updateAgent, enrichOffer]);

  // Pull authoritative status + break fields from the backend (single source of
  // truth for the break timer — never trusts a client clock).
  const syncMe = useCallback(async () => {
    try {
      const fresh = await api.me();
      updateAgent({
        status: fresh.status, state: fresh.state,
        break_code: fresh.break_code ?? null,
        break_name: fresh.break_name ?? null,
        break_started_at: fresh.break_started_at ?? null,
      });
    } catch { /* keep existing */ }
  }, [updateAgent]);

  async function handleLogout() {
    await stopSoftphone();
    try { await api.setStatus('Logged Out'); } catch {}
    logout();
  }

  async function handleStatusChange(newStatus) {
    updateAgent({ status: newStatus });
    if (newStatus === 'Logged Out') { stopSoftphone(); setTimeout(logout, 500); return; }
    await syncMe();          // reconcile break_code/break_name/break_started_at
  }

  // Return-to-Available from the current-break panel. Sends NO break code.
  async function handleReturnFromBreak() {
    try {
      await api.setStatus('Available');
      await syncMe();
    } catch (err) {
      setToast(err.message || 'Failed to return to Available');
    }
  }

  const queueSection = (
    <Section
      title="My queues"
      actions={<span className="text-[0.6875rem] text-ink-faint">Live · 3s refresh</span>}
    >
      {queues.length === 0 ? (
        <EmptyState title="No queues assigned">
          Ask your supervisor to add you to a queue in the Admin UI.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {queues.map(q => <QueueCard key={q.name} q={q} />)}
        </div>
      )}
    </Section>
  );

  // Everything below is presentation. `phone` is the live usePhone() object, or null
  // when the browser phone is not built in.
  function renderDesk(phone) {
    const sipCall = phone?.state?.call || null;
    const result = correlate({
      esl: callState,
      sip: sipCall,
      phoneSignedIn: phone?.state?.registration === 'registered',
    });
    const phoneLamp = phone
      ? (phone.configError ? { level: 'off', label: 'Browser phone not configured' }
        : !phone.eligibility?.eligible ? { level: 'off', label: 'Browser phone not available for this agent' }
        : phone.indicator)
      : null;
    const lamps = buildLamps({ apiOk, socketConnected: socketUp, eslConnected: eslConn, phone: phoneLamp });
    const notReachable = shouldWarnNotReachable({ agentStatus, phone });

    const context = (
      <>
        <CustomerPanel interaction={result.interaction} />
        <QueueSummary queues={queues} />
      </>
    );

    return (
      <AppShell
        agent={agent}
        queueNames={queues.map(q => q.name)}
        lamps={lamps}
        theme={theme}
        onLogout={handleLogout}
        nav={NAV}
        activeView={view}
        onNavigate={setView}
        aside={context}
        statusSelector={
          <StatusSelector
            currentStatus={agentStatus}
            breakName={agent?.break_name}
            breakCodes={breakCodes}
            onStatusChange={handleStatusChange}
            onError={setToast}
          />
        }
      >
        {toast && (
          <div role="alert" className="rounded-lg p-3 border border-status-error/40 bg-status-error/10
                          flex items-center justify-between gap-3">
            <span className="text-sm text-status-error">{toast}</span>
            <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-status-error/70 hover:text-status-error">
              <X size={15} />
            </button>
          </div>
        )}

        {notReachable && <NotReachableBanner extension={phone?.eligibility?.extension || agent?.avaya_extension} />}

        {/* Other pages: a compact call bar keeps the call visible and controllable. */}
        {view !== 'dashboard' && result.interaction && (
          <CallStrip interaction={result.interaction} phone={phone} onOpenPhone={() => setView('dashboard')} />
        )}

        {view === 'dashboard' && (
          <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)] items-start">
            {/* Telephony console: keypad always visible, all call actions */}
            <PhoneConsole phone={phone} interaction={result.interaction} dialRequest={dialRequest} />

            <div className="space-y-4 min-w-0">
              <InteractionWorkspace
                result={result}
                phone={phone}
                agentStatus={agentStatus}
                recentNumbers={recentNumbers}
                recentCalls={recentCalls}
                recentLoading={recentLoading}
                summary
                onPickNumber={(n) => setDialRequest({ number: n, at: Date.now() })}
              />
              {agentStatus === 'On Break' && agent?.break_started_at && (
                <CurrentBreakPanel
                  breakName={agent.break_name}
                  breakCode={agent.break_code}
                  breakStartedAt={agent.break_started_at}
                  maxDurationSeconds={currentBreakCfg?.max_duration_seconds}
                  warnThresholdSeconds={currentBreakCfg?.warn_threshold_seconds}
                  onReturn={handleReturnFromBreak}
                />
              )}
              <ActivityStrip perf={perf} />
              {/* Context panel moves here below 1280 px. */}
              <div className="xl:hidden rounded-lg border border-panel-border bg-panel-surface">{context}</div>
            </div>
          </div>
        )}

        {view === 'queues' && (
          <>
            {queueSection}
            <PerformanceCard perf={perf} loading={perfLoading} />
          </>
        )}

        {view === 'calls'  && <CallHistory />}
        {view === 'breaks' && <BreakHistory breakCodes={breakCodes} />}

        <p className="text-[0.6875rem] text-ink-faint text-center pt-2">
          CC Version 1.0.0 · © Naresh — All Rights Reserved
        </p>
      </AppShell>
    );
  }

  if (!PhoneBridge) return renderDesk(null);
  return (
    <Suspense fallback={renderDesk(null)}>
      <PhoneBridge agent={agent}>{renderDesk}</PhoneBridge>
    </Suspense>
  );
}
