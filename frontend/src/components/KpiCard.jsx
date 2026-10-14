/**
 * KpiCard — compact, number-first metric tile.
 *
 * Layout: label + small semantic icon on one line, the value as the hero, an
 * optional one-line context underneath. Colour identity is carried by the icon
 * only; the card itself stays neutral so a quiet floor reads calm. Operational
 * urgency is expressed with `alert` (left rule + tinted value), never by
 * flooding every tile with colour.
 *
 * Props (backwards compatible):
 *   label, value, suffix, icon, sub, trend
 *   tone   — icon colour: default|green|amber|red|blue|purple|orange
 *   alert  — null | 'warning' | 'critical'  (adds rule + value colour + label)
 *   title  — optional tooltip / accessible description
 */
const ICON_TONE = {
  default: 'text-ink-faint',
  green:   'text-status-available',
  amber:   'text-status-ringing',
  red:     'text-status-error',
  blue:    'text-status-oncall',
  purple:  'text-status-onbreak',
  orange:  'text-status-noanswer',
};

const ALERT = {
  warning:  { rule: 'bg-status-ringing', value: 'text-status-ringing', ring: 'border-status-ringing/40' },
  critical: { rule: 'bg-status-error',   value: 'text-status-error',   ring: 'border-status-error/45' },
};

export default function KpiCard({ label, value, suffix, tone = 'default', icon: Icon, sub, trend, alert = null, title }) {
  const a = alert ? ALERT[alert] : null;
  return (
    <div
      className={`relative overflow-hidden rounded-md border bg-surface shadow-card dark:shadow-card-dark
                  px-3.5 py-3 flex flex-col gap-1.5 min-w-0 ${a ? a.ring : 'border-border'}`}
      title={title}
    >
      {a && <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${a.rule}`} aria-hidden="true" />}

      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="text-[12px] font-medium text-ink-dim leading-tight truncate">{label}</p>
        {Icon && <Icon size={15} strokeWidth={2} className={`shrink-0 ${ICON_TONE[tone] ?? ICON_TONE.default}`} aria-hidden="true" />}
      </div>

      <p className={`text-metric ${a ? a.value : ''}`}>
        {value}
        {suffix && <span className="text-[13px] ml-1 font-medium text-ink-faint">{suffix}</span>}
      </p>

      {(sub || trend) && (
        <p className={`text-[11px] leading-tight truncate ${a ? a.value : 'text-ink-faint'}`}>{sub || trend}</p>
      )}
      {sub && trend && <p className="text-[11px] leading-tight text-ink-faint truncate">{trend}</p>}
    </div>
  );
}
