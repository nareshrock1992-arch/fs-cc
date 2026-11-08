import React from 'react';
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
import InteractionWorkspace from './InteractionWorkspace.jsx';
import CallStrip from './CallStrip.jsx';
import {
  CustomerPanel, QueueSummary, ActivityStrip, NotReachableBanner, shouldWarnNotReachable,
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
  } = data;
  const {
    setView, setToast, setDialRequest, onLogout, onStatusChange, onReturnFromBreak,
  } = actions;

  const result = correlate({
    esl: callState,
    sip: phone?.state?.call || null,
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
      queueNames={queues.map((q) => q.name)}
      lamps={lamps}
      theme={theme}
      onLogout={onLogout}
      nav={nav}
      activeView={view}
      onNavigate={setView}
      aside={context}
      statusSelector={
        <StatusSelector
          currentStatus={agentStatus}
          breakName={agent?.break_name}
          breakCodes={breakCodes}
          onStatusChange={onStatusChange}
          onError={setToast}
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

      {notReachable && <NotReachableBanner extension={phone?.eligibility?.extension || agent?.avaya_extension} />}

      {/* Other pages: a compact call bar keeps the call visible and controllable. */}
      {view !== 'dashboard' && result.interaction && (
        <CallStrip interaction={result.interaction} phone={phone} onOpenPhone={() => setView('dashboard')} />
      )}

      {view === 'dashboard' && (
        <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)] items-start">
          <div className="w-full max-w-[28rem] mx-auto lg:max-w-none lg:mx-0">
            <PhoneConsole phone={phone} interaction={result.interaction} dialRequest={dialRequest} />
          </div>
          <div className="space-y-4 min-w-0">
            <InteractionWorkspace
              result={result}
              phone={phone}
              agentStatus={agentStatus}
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
          <Section title="My queues" actions={<span className="text-[0.6875rem] text-ink-faint">Live · 3s refresh</span>}>
            {queues.length === 0 ? (
              <EmptyState title="No queues assigned">Ask your supervisor to add you to a queue in the Admin UI.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
