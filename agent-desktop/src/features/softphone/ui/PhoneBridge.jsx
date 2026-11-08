import React from 'react';
import { PhoneProvider } from '../PhoneProvider';
import { usePhone } from '../usePhone';

/**
 * PhoneBridge — gives the Agent Desktop shell the live browser-phone object
 * (state + actions from usePhone) through a render function:
 *
 *   <PhoneBridge agent={agent}>{(phone) => <Desk phone={phone} />}</PhoneBridge>
 *
 * Lazy-loaded only when VITE_WEBRTC_ENABLED=true, so sip.js stays out of the bundle
 * otherwise. Uses the same PhoneService singleton as before; engine unchanged.
 */
export default function PhoneBridge({ agent, children }) {
  return (
    <PhoneProvider agent={agent}>
      <Inner>{children}</Inner>
    </PhoneProvider>
  );
}

function Inner({ children }) {
  const phone = usePhone();
  return children(phone);
}
