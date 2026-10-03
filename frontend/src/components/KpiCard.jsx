// Icon-chip colours — strengthened for vivid, distinct, high-contrast symbols
// (bg-*-100 + text-*-700 in light; brighter tint + -300 text in dark).
const TONE = {
  default: {
    circle: 'bg-gray-100 dark:bg-panel-raised text-gray-600 dark:text-ink-dim',
    value:  'text-gray-900 dark:text-ink',
    card:   '',
  },
  green: {
    circle: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    value:  'text-emerald-700 dark:text-emerald-400',
    card:   '',
  },
  amber: {
    circle: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    value:  'text-amber-700 dark:text-amber-400',
    card:   '',
  },
  red: {
    circle: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
    value:  'text-red-700 dark:text-red-400',
    card:   '',
  },
  blue: {
    circle: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
    value:  'text-blue-700 dark:text-blue-400',
    card:   '',
  },
  purple: {
    circle: 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
    value:  'text-violet-700 dark:text-violet-400',
    card:   '',
  },
};

const ACCENT = {
  default: '',
  green:   'bg-emerald-500/60',
  amber:   'bg-amber-500/60',
  red:     'bg-red-500/60',
  blue:    'bg-blue-500/60',
  purple:  'bg-violet-500/60',
};

export default function KpiCard({ label, value, suffix, tone = 'default', icon: Icon, sub, trend }) {
  const t = TONE[tone] ?? TONE.default;
  const accent = ACCENT[tone] ?? '';

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-gray-200 dark:border-panel-border
                    bg-white dark:bg-panel-surface shadow-card p-4 flex items-center gap-3">

      {/* Icon chip */}
      {Icon && (
        <div className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${t.circle}`}>
          <Icon size={19} strokeWidth={1.9} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-widest font-semibold
                      text-ink-dim mb-0.5 leading-snug break-words">
          {label}
        </p>
        {/* Canonical KPI value — strong, high-contrast primary ink (not tinted),
            so the number has visual authority. Semantic colour is carried by the
            icon chip + accent stripe, not the figure itself. See `.text-metric`. */}
        <p className="text-metric">
          {value}
          {suffix && <span className="text-sm ml-1 font-normal opacity-60">{suffix}</span>}
        </p>
        {sub && (
          <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-1 truncate">{sub}</p>
        )}
        {trend && (
          <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-1 truncate">{trend}</p>
        )}
      </div>

      {/* Accent stripe — right edge */}
      {accent && (
        <div className={`absolute right-0 top-2 bottom-2 w-[3px] rounded-full ${accent}`} />
      )}
    </div>
  );
}
