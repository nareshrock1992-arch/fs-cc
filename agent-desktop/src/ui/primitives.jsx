import React from 'react';

/**
 * Agent Desktop design-system primitives (Phase 2).
 * Token-backed (CSS variables in index.css, light + dark). No new dependencies.
 * Rules: 1-px borders, radius 6 (controls) / 8 (cards), no gradients, glows or blur.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-panel-surface disabled:opacity-50 disabled:cursor-not-allowed';

const BUTTON_VARIANTS = {
  primary:   'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-panel-border bg-panel-surface text-ink hover:bg-panel-raised',
  ghost:     'text-ink-dim hover:bg-panel-raised hover:text-ink',
  danger:    'bg-[rgb(var(--btn-danger))] text-white hover:opacity-90',
  call:      'bg-[rgb(var(--btn-call))] text-white hover:opacity-90',
  toggled:   'border border-primary bg-primary/10 text-primary',
};

const BUTTON_SIZES = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-4 text-sm',
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/** Square icon-only button. `label` is required: it becomes aria-label and the tooltip. */
export function IconButton({ label, variant = 'ghost', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], 'h-9 w-9', className)}
      {...props}
    />
  );
}

/** Status level -> colour. Used by lamps, dots and badges everywhere. */
export const LEVEL_CLASS = {
  ok:    'bg-status-available',
  busy:  'bg-status-oncall',
  warn:  'bg-status-ringing',
  break: 'bg-status-onbreak',
  error: 'bg-status-error',
  off:   'bg-status-loggedout',
};

export function StatusDot({ level = 'off', className }) {
  return <span aria-hidden="true" className={cx('inline-block w-2 h-2 rounded-full shrink-0', LEVEL_CLASS[level], className)} />;
}

const BADGE_TONES = {
  neutral: 'bg-panel-raised text-ink-dim border-panel-border',
  ok:      'bg-status-available/10 text-status-available border-status-available/30',
  busy:    'bg-status-oncall/10 text-status-oncall border-status-oncall/30',
  warn:    'bg-status-ringing/10 text-status-ringing border-status-ringing/30',
  break:   'bg-status-onbreak/10 text-status-onbreak border-status-onbreak/30',
  error:   'bg-status-error/10 text-status-error border-status-error/30',
};

export function Badge({ tone = 'neutral', className, children }) {
  return (
    <span className={cx('inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[0.6875rem] font-medium', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Card with an optional header row (title + actions). */
export function Section({ title, icon: Icon, actions, className, bodyClassName, children, ...rest }) {
  return (
    <section className={cx('rounded-lg border border-panel-border bg-panel-surface', className)} {...rest}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 h-11 border-b border-panel-border">
          <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
            {Icon && <Icon size={15} className="text-ink-dim" aria-hidden="true" />}
            {title}
          </h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {Icon && <Icon size={22} className="text-ink-faint" aria-hidden="true" />}
      <p className="text-sm font-medium text-ink-dim">{title}</p>
      {children && <p className="text-xs text-ink-faint max-w-sm">{children}</p>}
    </div>
  );
}
