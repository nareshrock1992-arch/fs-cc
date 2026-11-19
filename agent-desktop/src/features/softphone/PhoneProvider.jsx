import React, { createContext, useMemo } from 'react';
import { buildAppConfig, getSoftphoneEligibility } from './adapters/configAdapter';
import { getPhoneService } from './phoneSingleton';
import { api, apiBase as defaultApiBase } from '../../api/client.js';

export const PhoneContext = createContext(null);

/**
 * PhoneProvider — gives children access to the single PhoneService.
 *
 * - The service comes from the lazy module-level singleton; this component never
 *   constructs it directly (StrictMode-safe).
 * - It does NOT log the phone out on unmount: StrictMode unmounts and remounts effects,
 *   and a desk logout calls usePhone().logout() explicitly.
 * - The service is only created for an agent the SERVER allows to use the browser
 *   phone (CP3-E); otherwise nothing phone-related is started.
 * - `fetchTicket` / `apiBase` can be injected (tests); default = FS-CC API client.
 */
export function PhoneProvider({ agent, env, fetchTicket, apiBase, children }) {
  const value = useMemo(() => {
    const eligibility = getSoftphoneEligibility(agent);
    const { config, error } = buildAppConfig(env);
    const service = config && eligibility.eligible ? getPhoneService(config) : null;
    return {
      service, config, configError: error, agent, eligibility,
      fetchTicket: fetchTicket || api.webrtcTicket,
      apiBase: apiBase ?? defaultApiBase(),
    };
  }, [agent, env, fetchTicket, apiBase]);

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}
