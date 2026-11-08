/**
 * Public surface of the softphone feature. Code outside features/softphone/ imports
 * only from here, never from engine/ directly.
 *
 * CP-4: provider, hook and helpers. CP-5: SoftphonePanel and stopSoftphoneIfActive().
 * Dashboard.jsx loads this lazily, and only when VITE_WEBRTC_ENABLED === 'true'.
 */
import { peekPhoneService } from './phoneSingleton';

export { default as SoftphonePanel } from './ui/SoftphonePanel';
export { PhoneProvider } from './PhoneProvider';
export { usePhone } from './usePhone';
export { isWebrtcEnabled, getSoftphoneEligibility } from './adapters/configAdapter';
export { describePhoneIndicator } from './adapters/agentStateAdapter';

/**
 * Log the browser phone out if it was ever started. Called on desk logout.
 * Never creates the engine, and never throws.
 */
export async function stopSoftphoneIfActive() {
  const service = peekPhoneService();
  if (!service) return;
  try {
    await service.logout();
  } catch {
    /* desk logout must continue even if the phone is already gone */
  }
}
