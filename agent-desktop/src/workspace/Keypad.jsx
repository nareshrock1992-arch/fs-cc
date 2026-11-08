import React from 'react';

export const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

/** Compact 3×4 keypad (fixed width; never fills the workspace). */
export default function Keypad({ onKey, label }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1 w-[11.5rem]">
      {KEYS.map(([k, sub]) => (
        <button
          key={k}
          type="button"
          aria-label={k}
          onClick={() => onKey(k)}
          className="h-10 rounded-md border border-panel-border bg-panel-surface hover:bg-panel-raised
                     flex flex-col items-center justify-center leading-none text-ink
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="text-base font-medium font-mono">{k}</span>
          <span className="text-[0.5625rem] tracking-wider text-ink-faint h-2.5">{sub}</span>
        </button>
      ))}
    </div>
  );
}
