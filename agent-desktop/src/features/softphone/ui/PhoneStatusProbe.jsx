import React, { useEffect } from 'react';
import { PhoneProvider } from '../PhoneProvider';
import { usePhone } from '../usePhone';

/**
 * PhoneStatusProbe — renders nothing; reports the browser phone indicator
 * ({ level, label }) to the shell so the header can show a separate "Phone" lamp.
 * Uses the same PhoneService singleton as SoftphonePanel (no second phone is created
 * unless configuration exists, exactly as the panel). Read-only: no actions.
 */
export default function PhoneStatusProbe({ agent, onChange }) {
  return (
    <PhoneProvider agent={agent}>
      <Reporter onChange={onChange} />
    </PhoneProvider>
  );
}

function Reporter({ onChange }) {
  const { indicator, eligibility, configError } = usePhone();
  const level = configError || !eligibility.eligible ? 'off' : indicator.level;
  const label = configError
    ? 'Browser phone not configured'
    : !eligibility.eligible ? 'Browser phone not available for this agent' : indicator.label;
  useEffect(() => { onChange({ level, label }); }, [level, label, onChange]);
  return null;
}
