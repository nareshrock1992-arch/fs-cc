import React, { createContext, useMemo } from 'react';
import { buildAppConfig, getSoftphoneEligibility } from './adapters/configAdapter';
import { getPhoneService } from './phoneSingleton';

export const PhoneContext = createContext(null);

/**
 * PhoneProvider — gives children access to the single PhoneService.
 *
 * - The service comes from the lazy module-level singleton; this component never
 *   constructs it directly (StrictMode-safe).
 * - It does NOT log the phone out on unmount: StrictMode unmounts and remounts effects,
 *   and a desk logout calls usePhone().logout() explicitly (wired in CP-5).
 * - When configuration is missing, children still render; usePhone() reports the error.
 */
export function PhoneProvider({ agent, env, children }) {
  const value = useMemo(() => {
    const { config, error } = buildAppConfig(env);
    const service = config ? getPhoneService(config) : null;
    return { service, config, configError: error, agent, eligibility: getSoftphoneEligibility(agent) };
  }, [agent, env]);

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}
