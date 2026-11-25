import { phoneStatusView } from '../lib/phoneStatus.js';

const TONE = {
  ok:    'text-emerald-600 dark:text-lamp-ok',
  warn:  'text-amber-600 dark:text-lamp-warn',
  bad:   'text-red-600 dark:text-lamp-alert',
  muted: 'text-ink-faint',
};
const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', muted: 'bg-ink-faint/50' };

/** Small browser-phone status line under an agent's status. Renders nothing for desk-phone agents. */
export default function PhoneStatus({ status, className = '' }) {
  const v = phoneStatusView(status);
  if (!v) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[0.6875rem] whitespace-nowrap ${TONE[v.tone]} ${className}`}
          title={v.title} data-testid="phone-status">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[v.tone]}`} aria-hidden="true" />
      {v.label}
    </span>
  );
}
