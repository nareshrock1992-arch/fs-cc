import React from 'react';

export const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

/**
 * Full telephone keypad for the phone console: always visible, 3×4, 52 px keys.
 * Disabled keys stay in place so the layout never jumps between call states.
 */
export default function PhoneKeypad({ onKey, label, disabled = false }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      {KEYS.map(([k, sub]) => (
        <button
          key={k}
          type="button"
          aria-label={k}
          disabled={disabled}
          onClick={() => onKey(k)}
          className="h-[3.25rem] rounded-lg border border-panel-border bg-panel-surface text-ink
                     hover:bg-panel-raised active:bg-panel-border transition-colors
                     flex flex-col items-center justify-center leading-none
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-focus
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel-surface"
        >
          <span className="text-xl font-medium font-mono">{k}</span>
          <span className="mt-1 h-2.5 text-[0.5625rem] tracking-[0.15em] text-ink-faint">{sub}</span>
        </button>
      ))}
    </div>
  );
}
