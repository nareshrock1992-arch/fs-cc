/**
 * agentStateAdapter — maps engine PhoneState to a desk indicator.
 *
 * Phase 2: display only. It never changes the agent's FS-CC status.
 * Phase 5 adds the PHONE_OFFLINE handling (Q10/Q13), which is server-side.
 *
 * @param {object} state engine PhoneState
 * @returns {{ level: 'off' | 'ok' | 'busy' | 'warn' | 'error', label: string }}
 */
export function describePhoneIndicator(state) {
  if (!state || !state.account) return { level: 'off', label: 'Phone off' };
  if (state.registration === 'failed') return { level: 'error', label: 'Phone sign-in failed' };
  if (!state.online || state.connection === 'reconnecting') {
    return { level: 'warn', label: 'Phone reconnecting…' };
  }
  if (state.connection === 'connecting' || state.registration === 'registering') {
    return { level: 'warn', label: 'Phone connecting…' };
  }
  if (state.call && state.call.status !== 'ended') return { level: 'busy', label: 'On a call' };
  if (state.registration === 'registered') return { level: 'ok', label: 'Phone ready' };
  return { level: 'warn', label: 'Phone not registered' };
}
