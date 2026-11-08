import React from 'react';
import { Headset, LogOut } from 'lucide-react';
import { IconButton } from '../ui/primitives.jsx';
import ConnectionLamps from './ConnectionLamps.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

/**
 * AppShell — top bar + navigation rail + main workspace (+ optional context panel).
 *
 *   ┌ top bar ───────────────────────────────────────────────┐
 *   │ rail │ main                                 │ aside?   │
 *   └──────┴──────────────────────────────────────┴──────────┘
 *
 * Under 768 px the rail becomes a bottom bar. The aside (context panel) is
 * shown from 1280 px; Phase 3 fills it.
 */
export default function AppShell({
  agent, queueNames = [], lamps, statusSelector, theme, onLogout,
  nav, activeView, onNavigate, aside, children,
}) {
  return (
    <div className="h-full flex flex-col bg-panel-bg">
      <header className="h-14 shrink-0 flex items-center gap-3 px-3 sm:px-4 border-b border-panel-border bg-panel-surface">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Headset size={16} className="text-white" aria-hidden="true" />
          </span>
          <span className="hidden md:block text-sm font-semibold text-ink">Agent Desktop</span>
        </div>

        {queueNames.length > 0 && (
          <p className="hidden xl:block text-xs text-ink-dim truncate max-w-xs" title={queueNames.join(', ')}>
            Queues: <span className="text-ink">{queueNames.join(', ')}</span>
          </p>
        )}

        <div className="flex-1" />

        <ConnectionLamps lamps={lamps} />

        <div className="hidden sm:flex flex-col items-end leading-tight pl-3 border-l border-panel-border">
          <span className="text-sm font-semibold text-ink">{agent?.full_name}</span>
          <span className="text-[0.6875rem] text-ink-dim">
            {agent?.agent_id}{agent?.avaya_extension ? ` · Ext ${agent.avaya_extension}` : ''}
          </span>
        </div>

        {statusSelector}

        <ThemeToggle isDark={theme.isDark} onToggle={theme.toggle} />
        <IconButton label="Sign out of Agent Desktop" onClick={onLogout}>
          <LogOut size={16} />
        </IconButton>
      </header>

      <div className="flex-1 min-h-0 flex flex-col-reverse md:flex-row">
        <nav
          aria-label="Main"
          className="shrink-0 flex md:flex-col items-center justify-around md:justify-start gap-1 p-1.5 md:py-3
                     md:w-[4.5rem] border-t md:border-t-0 md:border-r border-panel-border bg-panel-surface"
        >
          {nav.map(({ key, label, Icon }) => {
            const active = activeView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onNavigate(key)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 w-16 py-2 rounded-md text-[0.6875rem] font-medium transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-focus
                  ${active ? 'bg-primary/10 text-primary' : 'text-ink-dim hover:bg-panel-raised hover:text-ink'}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="leading-none text-center">{label}</span>
              </button>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4">{children}</div>
        </main>

        {aside && (
          <aside className="hidden xl:block w-80 shrink-0 overflow-y-auto border-l border-panel-border bg-panel-surface">
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}
