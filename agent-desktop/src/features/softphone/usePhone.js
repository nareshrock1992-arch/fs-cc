import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { PhoneContext } from './PhoneProvider';
import { buildCredentials } from './adapters/configAdapter';
import { resolveWssUrl } from './adapters/authAdapter';
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
  const { service, config, configError, agent, eligibility } = ctx;

  const subscribe = service ? service.store.subscribe.bind(service.store) : noopSubscribe;
  const getSnapshot = service ? service.store.get.bind(service.store) : getNull;
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(
    async (password) => {
      if (!service) return { ok: false, error: configError };
      const { credentials, error } = buildCredentials({ agent, password, config });
      if (!credentials) return { ok: false, error };
      const wssUrl = await resolveWssUrl(config);
      await service.login({ ...credentials, wssUrl });
      return { ok: true };
    },
    [service, agent, config, configError],
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
