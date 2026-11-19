import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { PhoneContext } from './PhoneProvider';
import { buildCredentials } from './adapters/configAdapter';
import { createTicketProvider, relayUrlFor, requestTicket } from './adapters/authAdapter';
import { describePhoneIndicator } from './adapters/agentStateAdapter';

const noopSubscribe = () => () => {};
const getNull = () => null;

/**
 * usePhone — the React face of the engine.
 *
 * Returns the live PhoneState plus actions. The agent types ONLY the password (R-3);
 * extension, domain and WSS URL come from the agent contact and configuration.
 */
export function usePhone() {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error('usePhone() must be used inside <PhoneProvider>.');
  const { service, config, configError, agent, eligibility, fetchTicket, apiBase } = ctx;

  const subscribe = service ? service.store.subscribe.bind(service.store) : noopSubscribe;
  const getSnapshot = service ? service.store.get.bind(service.store) : getNull;
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Sign-in (CP3-E): ask the FS-CC backend for a single-use relay ticket with the
  // agent's own session, then connect to the FS-CC relay. Extension and SIP domain
  // come from the server; the agent types only the SIP password (memory only).
  // Every later reconnect fetches a NEW ticket through ticketProvider.
  const login = useCallback(
    async (password) => {
      if (!service) return { ok: false, error: configError || eligibility.reason };
      let ticket;
      try {
        ticket = await requestTicket(fetchTicket, 'connect');
      } catch (err) {
        return { ok: false, error: err.message };
      }
      let wssUrl;
      try { wssUrl = relayUrlFor(ticket, apiBase); } catch (err) { return { ok: false, error: err.message }; }
      const ticketProvider = createTicketProvider({ fetchTicket, apiBase, extension: String(ticket.extension) });
      const { credentials, error } = buildCredentials({
        ticket, password, wssUrl, ticketProvider, displayName: agent?.full_name,
      });
      if (!credentials) return { ok: false, error };
      await service.login(credentials);
      return { ok: true };
    },
    [service, agent, configError, eligibility, fetchTicket, apiBase],
  );

  const actions = useMemo(() => {
    const call = (name) => (...args) => (service ? service[name](...args) : undefined);
    return {
      logout: call('logout'),
      dial: call('dial'),
      answer: call('answer'),
      reject: call('reject'),
      hangup: call('hangup'),
      toggleMute: call('toggleMute'),
      toggleHold: call('toggleHold'),
      transfer: call('transfer'),
      startConsult: call('startConsult'),
      cancelConsult: call('cancelConsult'),
      swapCalls: call('swapCalls'),
      completeConsult: call('completeConsult'),
      mergeConference: call('mergeConference'),
      sendDtmf: call('sendDtmf'),
      refreshDevices: call('refreshDevices'),
      selectInput: call('selectInput'),
      selectOutput: call('selectOutput'),
      unlockAudio: call('unlockAudio'),
      clearError: call('clearError'),
    };
  }, [service]);

  return {
    available: Boolean(service) && eligibility.eligible,
    configError,
    eligibility,
    state,
    indicator: describePhoneIndicator(state),
    login,
    ...actions,
  };
}
