import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import CurrentBreakPanel from '../components/CurrentBreakPanel.jsx';
import CallHistory from '../components/CallHistory.jsx';
import BreakHistory from '../components/BreakHistory.jsx';
import QueueCard from '../components/QueueCard.jsx';
import PerformanceCard from '../components/PerformanceCard.jsx';
import AppShell from '../shell/AppShell.jsx';
import StatusSelector from '../shell/StatusSelector.jsx';
import { buildLamps } from '../shell/ConnectionLamps.jsx';
import { Section, EmptyState } from '../ui/primitives.jsx';
import { correlate } from '../interactions/correlate.js';
import PhoneConsole from './phone/PhoneConsole.jsx';
import IncomingCallNotification from './phone/IncomingCallNotification.jsx';
import { PhoneRecoveredPrompt, PhoneDisabledNotice } from './phone/PhoneNotices.jsx';
import WrapUpPanel from './WrapUpPanel.jsx';
import PhoneConnectionStatus from '../shell/PhoneConnectionStatus.jsx';
import { phonePresence, availableBlockedReason, showRecoveryPrompt, PHONE } from '../features/softphone/presence.js';
import InteractionWorkspace from './InteractionWorkspace.jsx';
import CallStrip from './CallStrip.jsx';
import {
  CustomerPanel, QueueSummary, ActivityStrip, NotReachableBanner,
} from './ContextPanels.jsx';

/**
 * Desk — the whole Agent Desktop layout (presentation only).
 * Dashboard.jsx owns all data, polling, socket events and status logic and passes them in;
 * `phone` is the live usePhone() object (null when the browser phone is not built in).
 */
export default function Desk({ phone, data, actions, theme, nav }) {
  const {
    agent, agentStatus, view, queues, perf, perfLoading, callState, apiOk, socketUp, eslConn,
    breakCodes, currentBreakCfg, toast, recentCalls, recentLoading, dialRequest,
    webrtcAllowed = false, serverPhone = 'none', webrtcRevoked = false, wrapUpSeconds = null,
  } = data;
  const {
    setView, setToast, setDialRequest, onLogout, onStatusChange, onReturnFromBreak,
    onPhoneDisabled = () => {},
  } = actions;

  // Browser phone in use by THIS agent (server decides: mode, switch, internal, active).
  const usesBrowserPhone = Boolean(webrtcAllowed);
  const presence = phonePresence({ allowed: usesBrowserPhone, engine: phone?.state || null, server: serverPhone });
  const callOnPhone = Boolean(phone?.state?.call && phone.state.call.status !== 'ended');

  // Supervisor turned the browser phone off: never cut a call — sign the phone out
  // only once no call is active, then hide it.
  useEffect(() => {
    if (!webrtcRevoked || callOnPhone) return;
    let done = false;
    Promise.resolve(phone?.logout?.()).catch(() => {}).finally(() => { if (!done) onPhoneDisabled(); });
    return () => { done = true; };
  }, [webrtcRevoked, callOnPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = correlate({
    esl: callState,
    sip: phone?.state?.call || null,
    phoneSignedIn: phone?.state?.registration === 'registered',
  });
  // Desk-phone agents (EXTERNAL_PBX, gateway, not enabled) get no phone lamp at all.
  const phoneLamp = usesBrowserPhone && presence.key !== PHONE.HIDDEN
    ? { level: presence.level, label: presence.detail }
    : null;
  const lamps = buildLamps({ apiOk, socketConnected: socketUp, eslConnected: eslConn, phone: phoneLamp });
  // Warn only when the phone really cannot take calls (signed out, failed, offline) —
  // not during a short reconnect, which the 15 s grace covers without any state change.
  const notReachable = usesBrowserPhone && agentStatus === 'Available'
    && [PHONE.SIGNED_OUT, PHONE.FAILED, PHONE.OFFLINE].includes(presence.key);
  const blockedReason = usesBrowserPhone ? availableBlockedReason(presence) : null;
  const recovered = usesBrowserPhone && showRecoveryPrompt({ presence, agentStatus, breakCode: agent?.break_code });
  // Keep the console (mute, hold, end call) for a call in progress even after a
  // supervisor switched the phone off; hide it once the call is over.
  const showConsole = usesBrowserPhone && Boolean(phone) && (!webrtcRevoked || callOnPhone);

  const context = (
    <>
      <CustomerPanel interaction={result.interaction} />
      <QueueSummary queues={queues} />
    </>
  );

  return (
    <AppShell
      agent={agent}
      queueNames={queues.map((q) => q.name)}
      lamps={lamps}
      theme={theme}
      onLogout={onLogout}
      nav={nav}
      activeView={view}
      onNavigate={setView}
      aside={context}
      phoneStatus={usesBrowserPhone ? <PhoneConnectionStatus presence={presence} /> : null}
      statusSelector={
        <StatusSelector
          currentStatus={agentStatus}
          breakName={agent?.break_name}
          breakCodes={breakCodes}
          onStatusChange={onStatusChange}
          onError={setToast}
          availableBlockedReason={blockedReason}
        />
      }
    >
      {toast && (
        <div role="alert" className="rounded-lg p-3 border border-status-error/40 bg-status-error/10 flex items-center justify-between gap-3">
          <span className="text-sm text-status-error">{toast}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-status-error/70 hover:text-status-error">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Pages without the phone console: a call ringing on this browser phone is announced
          at the top with Answer / Reject (keyboard focus on Answer). On the Workspace page the
          console and the call card already show it. */}
      {view !== 'dashboard' && (
        <IncomingCallNotification interaction={result.interaction} phone={showConsole ? phone : null} />
      )}

      {webrtcRevoked && <PhoneDisabledNotice inCall={callOnPhone} />}
      {recovered && <PhoneRecoveredPrompt onAvailable={onReturnFromBreak} />}
      {notReachable && <NotReachableBanner extension={phone?.eligibility?.extension || agent?.avaya_extension} />}

      {/* Other pages: a compact call bar keeps the call visible and controllable. */}
      {view !== 'dashboard' && result.interaction && (
        <CallStrip interaction={result.interaction} phone={phone} onOpenPhone={() => setView('dashboard')} hideRingActions={showConsole} />
      )}

      {view === 'dashboard' && (
        <div className={showConsole
          ? 'grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] items-start'
          : 'grid grid-cols-[minmax(0,1fr)] gap-4 items-start'}>
          {/* Browser phone only for agents who use it; desk-phone agents see no dial pad. */}
          {showConsole && (
            <div className="w-full max-w-[26rem] mx-auto lg:max-w-none lg:mx-0">
              <PhoneConsole phone={phone} interaction={result.interaction} dialRequest={dialRequest} presence={presence} />
            </div>
          )}
          <div className="space-y-4 min-w-0">
            <WrapUpPanel agentStatus={agentStatus} agentState={agent?.state} wrapUpSeconds={wrapUpSeconds} />
            <InteractionWorkspace
              result={result}
              phone={phone}
              agentStatus={agentStatus}
              queues={queues}
              perf={perf}
              recentCalls={recentCalls}
              recentLoading={recentLoading}
              onPickNumber={(n) => setDialRequest({ number: n, at: Date.now() })}
            />
            {agentStatus === 'On Break' && agent?.break_started_at && (
              <CurrentBreakPanel
                breakName={agent.break_name}
                breakCode={agent.break_code}
                breakStartedAt={agent.break_started_at}
                maxDurationSeconds={currentBreakCfg?.max_duration_seconds}
                warnThresholdSeconds={currentBreakCfg?.warn_threshold_seconds}
                onReturn={onReturnFromBreak}
                returnBlockedReason={blockedReason}
              />
            )}
            {result.interaction && <ActivityStrip perf={perf} />}
            {/* Context panel moves here below 1280 px. */}
            <div className="xl:hidden rounded-lg border border-panel-border bg-panel-surface">{context}</div>
          </div>
        </div>
      )}

      {view === 'queues' && (
        <>
          <Section title="My queues" actions={<span className="text-[0.6875rem] text-ink-faint">Live · 3s refresh</span>}>
            {queues.length === 0 ? (
              <EmptyState title="No queues assigned">Ask your supervisor to add you to a queue in the Admin UI.</EmptyState>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {queues.map((q) => <QueueCard key={q.name} q={q} />)}
              </div>
            )}
          </Section>
          <PerformanceCard perf={perf} loading={perfLoading} />
        </>
      )}

      {view === 'calls' && <CallHistory />}
      {view === 'breaks' && <BreakHistory breakCodes={breakCodes} />}

      <p className="text-[0.6875rem] text-ink-faint text-center pt-2">CC Version 1.0.0 · © Naresh — All Rights Reserved</p>
    </AppShell>
  );
}
