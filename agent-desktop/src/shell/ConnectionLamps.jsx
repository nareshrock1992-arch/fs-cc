import React from 'react';
import { StatusDot } from '../ui/primitives.jsx';

/**
 * Four separate connectivity indicators. They are deliberately NOT combined:
 * a working app with a disconnected phone must never look "all green".
 *
 * Each item: { key, label, level: ok|warn|error|off|busy, detail }
 */
export function buildLamps({ apiOk, socketConnected, eslConnected, phone }) {
  const lamps = [
    {
      key: 'api',
      label: 'Server',
      level: apiOk === null ? 'warn' : apiOk ? 'ok' : 'error',
      detail: apiOk === null ? 'Checking FS-CC server…' : apiOk ? 'FS-CC server reachable' : 'FS-CC server not reachable',
    },
    {
      key: 'live',
      label: 'Live',
      level: socketConnected ? 'ok' : 'error',
      detail: socketConnected ? 'Live updates connected' : 'Live updates disconnected — reconnecting',
    },
    {
      key: 'fs',
      label: 'FreeSWITCH',
      level: eslConnected ? 'ok' : 'error',
      detail: eslConnected ? 'FreeSWITCH connected' : 'FreeSWITCH offline',
    },
  ];
  if (phone) {
    lamps.push({ key: 'phone', label: 'Phone', level: phone.level, detail: phone.label });
  }
  return lamps;
}

export default function ConnectionLamps({ lamps }) {
  return (
    <ul className="flex items-center gap-3" aria-label="Connection status">
      {lamps.map((l) => (
        <li
          key={l.key}
          className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-dim"
          title={l.detail}
          data-level={l.level}
        >
          <StatusDot level={l.level} />
          <span className="hidden lg:inline">{l.label}</span>
          <span className="sr-only">{l.detail}</span>
        </li>
      ))}
    </ul>
  );
}
