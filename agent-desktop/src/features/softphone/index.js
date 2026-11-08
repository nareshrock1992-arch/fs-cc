/**
 * Public surface of the softphone feature. Code outside features/softphone/ imports
 * only from here, never from engine/ directly.
 *
 * CP-4: provider, hook and helpers. The SoftphonePanel (lazy, behind VITE_WEBRTC_ENABLED)
 * is added in CP-5. Nothing in the app imports this module yet.
 */
export { PhoneProvider } from './PhoneProvider';
export { usePhone } from './usePhone';
export { isWebrtcEnabled, getSoftphoneEligibility } from './adapters/configAdapter';
export { describePhoneIndicator } from './adapters/agentStateAdapter';
