export function FormField({ label, hint, children, required }) {
  return (
    <label className="block mb-4">
      <span className="block text-[0.8125rem] font-medium text-ink mb-1.5">
        {label}{required && <span className="text-status-error ml-0.5" aria-hidden="true">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-ink-dim mt-1 leading-snug">{hint}</span>
      )}
    </label>
  );
}

// Canonical input class — uses brand-blue focus ring (was lamp-live/amber before)
export const inputClass =
  'field-input';

export const buttonPrimary =
  'btn-primary';

export const buttonSecondary =
  'btn-secondary';

export const buttonDanger =
  'btn-danger';
