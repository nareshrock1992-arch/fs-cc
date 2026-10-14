import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sun, Moon, ChevronDown, ShieldCheck, LogOut, WifiOff } from 'lucide-react';
import { socket, useSocketEvent } from '../../api/socket.js';
import { useAuth, clearToken } from '../../hooks/useAuth.js';
import { pageMetaFor } from '../../lib/pageMeta.js';

// ── Admin avatar dropdown ─────────────────────────────────────────────────────

function AdminMenu({ user }) {
  const navigate   = useNavigate();
  const [open, setOpen] = useState(false);
  const ref        = useRef(null);
  const isAdmin    = user?.role === 'admin';

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const initials = (user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user?.username ?? 'user'}`}
        className={`flex items-center gap-2 rounded-md pl-1 pr-2 py-1 transition-colors
          hover:bg-surface-2 border border-transparent
          ${open ? 'border-border bg-surface-2' : ''}`}
      >
        <div className="h-7 w-7 rounded-full bg-navy flex items-center justify-center
          text-white text-[11px] font-semibold shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block text-left leading-tight">
          <p className="text-[13px] font-medium text-ink capitalize">
            {user?.username ?? 'User'}
          </p>
          <p className="text-[11px] text-ink-faint capitalize">
            {user?.role ?? ''}
          </p>
        </div>
        <ChevronDown size={14} className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 w-56 rounded-md
          border border-border bg-surface shadow-card-hover z-[200] overflow-hidden">

          <div className="px-4 py-3 border-b border-border">
            <p className="text-[13px] font-semibold text-ink capitalize">{user?.username}</p>
            <p className="text-[12px] text-ink-faint mt-0.5 capitalize">
              {user?.role} account
            </p>
          </div>

          <div className="py-1">
            {isAdmin && (
              <button
                role="menuitem"
                onClick={() => { setOpen(false); navigate('/users'); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-[13px]
                  text-ink-dim hover:bg-surface-2 hover:text-ink
                  transition-colors text-left"
              >
                <ShieldCheck size={15} className="shrink-0" aria-hidden="true" />
                User Management
              </button>
            )}

            <button
              role="menuitem"
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-2 text-[13px]
                text-danger hover:bg-danger/10 transition-colors text-left"
            >
              <LogOut size={15} className="shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contact-center connection status ─────────────────────────────────────────
// Healthy = quiet (dot + short label). Offline = an unmistakable red pill.
function ConnectionStatus({ connected }) {
  return (
    <div role="status" aria-live="polite">
      {connected ? (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[12px] font-medium text-status-available">
          <span className="h-2 w-2 rounded-full bg-status-available" aria-hidden="true" />
          <span className="hidden sm:inline">Contact center connected</span>
          <span className="sm:hidden">Connected</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold
          border border-status-error/35 bg-status-error/10 text-status-error">
          <WifiOff size={13} aria-hidden="true" />
          <span className="hidden sm:inline">Contact center offline</span>
          <span className="sm:hidden">Offline</span>
        </span>
      )}
    </div>
  );
}

// ── Main Topbar ───────────────────────────────────────────────────────────────

export default function Topbar({ isDark, toggleTheme }) {
  const { pathname }   = useLocation();
  const { user }       = useAuth();
  const { title, description } = pageMetaFor(pathname);
  const [eslConnected, setEslConnected] = useState(false);
  const [now, setNow]  = useState(new Date());

  const onEslStatus = useCallback((p) => setEslConnected(Boolean(p?.connected)), []);
  useSocketEvent('esl:status', onEslStatus);

  // If the socket was already connected before this component mounted (e.g.
  // the user just logged in — socket connected on page-load while the login
  // form was shown, so the connect-time esl:status event was missed), ask
  // the backend to re-send the current status now that we have a listener.
  useEffect(() => {
    if (socket.connected) {
      socket.emit('esl:get-status');
    }
    // On every subsequent (re)connect the backend already broadcasts esl:status
    // unconditionally, so no extra work is needed for the reconnect case.
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="relative z-30 h-14 shrink-0 border-b border-border bg-surface
      px-4 md:px-6 flex items-center justify-between gap-4">

      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] leading-tight text-ink truncate">
          {title}
        </h1>
        {description && (
          <p className="hidden md:block text-[12px] text-ink-faint leading-tight truncate mt-0.5">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
        <ConnectionStatus connected={eslConnected} />

        <span className="hidden lg:block h-6 w-px bg-border" aria-hidden="true" />

        {/* Clock */}
        <div className="hidden md:flex flex-col items-end leading-tight" aria-label="Current time">
          <span className="text-[13px] font-medium tabular-nums text-ink-dim">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className="text-[11px] text-ink-faint">
            {now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="h-8 w-8 flex items-center justify-center rounded-md
            text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <AdminMenu user={user} />
      </div>
    </header>
  );
}
