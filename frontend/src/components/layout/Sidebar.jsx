import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, PhoneCall, Users, Layers,
  Activity, BarChart3, Radio, ShieldCheck, Coffee, History, Headphones, Gauge, X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';

// Live Calls / Live Agents are consolidated into the primary "Live Operations"
// workspace. Their routes remain active (deep links preserved) but are no longer
// in the primary sidebar.
const BASE_NAV = [
  { to: '/',               label: 'Dashboard',       icon: LayoutDashboard, end: true },
  { to: '/live-operations',label: 'Live Operations', icon: Radio },
  { to: '/queue-stats',    label: 'Queue Stats',     icon: Activity },
  { to: '/agents',         label: 'Agents',          icon: Users },
  { to: '/queues',         label: 'Queues',          icon: Layers },
];

const MANAGEMENT_PATHS = ['/reports', '/agent-performance', '/reports/break-history', '/reports/call-history', '/break-codes', '/users'];

const REPORTS_ITEM       = { to: '/reports',                label: 'Reports',         icon: BarChart3 };
const AGENT_PERF_ITEM    = { to: '/agent-performance',      label: 'Agent Performance', icon: Gauge };
const BREAK_HISTORY_ITEM = { to: '/reports/break-history',  label: 'Break History',   icon: History };
const CALL_HISTORY_ITEM  = { to: '/reports/call-history',   label: 'Call History',    icon: PhoneCall };
const BREAK_CODES_ITEM   = { to: '/break-codes',            label: 'Break Codes',     icon: Coffee };
const USERS_ITEM         = { to: '/users',                  label: 'User Management', icon: ShieldCheck };

// ── Navigation item styling (semantic tokens, theme-aware) ───────────────────
// Light visual weight: quiet inactive items, one unmistakable active state
// (teal tint + left rule + bolder icon).
const NAV_BASE =
  'group relative flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[0.8125rem] ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-focus/50 focus-visible:ring-offset-0';
const NAV_INACTIVE =
  'font-medium text-ink-dim hover:bg-surface-2 hover:text-ink';
const NAV_ACTIVE =
  'font-semibold text-primary bg-primary/10';

function NavItem({ to, label, icon: Icon, end, onNavigate }) {
  return (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`
      }
    >
      {({ isActive }) => (
        <>
          {/* Subtle active left indicator */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary"
            />
          )}
          <Icon
            size={17}
            strokeWidth={isActive ? 2.2 : 1.8}
            className={isActive ? 'text-primary shrink-0' : 'text-ink-faint group-hover:text-ink-dim shrink-0'}
            aria-hidden="true"
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

// Sidebar — persistent column from `md` up; below that (small windows or high
// browser zoom) the SAME navigation opens as a slide-in drawer from the
// Topbar menu button, so navigation is never lost. Routes and permission
// filtering are identical in both presentations.
export default function Sidebar({ mobileOpen = false, onClose = () => {} }) {
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onClose]);

  return (
    <>
      <aside className="hidden md:flex md:flex-col w-56 shrink-0
        bg-surface border-r border-border" aria-label="Main navigation">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-gray-950/40" aria-label="Close navigation" onClick={onClose} />
          <aside className="relative flex flex-col w-64 max-w-[85vw] h-full bg-surface border-r border-border shadow-card-hover animate-slide-in-up">
            <button type="button" onClick={onClose} aria-label="Close navigation"
              className="absolute right-2 top-3 h-8 w-8 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-surface-2">
              <X size={18} aria-hidden="true" />
            </button>
            <SidebarContent onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarContent({ onNavigate }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  const canViewReports    = isAdmin || perms.includes('view_reports');
  const canManageBreaks   = isAdmin || perms.includes('manage_break_codes');

  const navItems = [
    ...BASE_NAV,
    ...(canViewReports  ? [REPORTS_ITEM, AGENT_PERF_ITEM, BREAK_HISTORY_ITEM, CALL_HISTORY_ITEM] : []),
    ...(canManageBreaks ? [BREAK_CODES_ITEM] : []),
    ...(isAdmin         ? [USERS_ITEM] : []),
  ];

  const operationsItems = navItems.filter(({ to }) => !MANAGEMENT_PATHS.includes(to));
  const managementItems = navItems.filter(({ to }) => MANAGEMENT_PATHS.includes(to));

  return (
    <>
      {/* Brand header — aligned with the 56px Topbar */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-border shrink-0">
        <div className="h-8 w-8 rounded-md bg-navy flex items-center justify-center shrink-0">
          <Radio size={15} className="text-white" aria-hidden="true" />
        </div>
        <div className="leading-tight min-w-0">
          <p className="font-semibold text-sm text-ink truncate">
            Switchboard
          </p>
          <p className="text-[0.6875rem] text-ink-faint font-medium">
            Contact Center
          </p>
        </div>
      </div>

      {/* Nav — fits without an internal scrollbar at normal heights;
          overflow-y-auto only engages on very short viewports. */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto">
        <p className="px-3 pb-1 text-[0.6875rem] font-semibold text-ink-faint">
          Operations
        </p>
        <div className="space-y-0.5">
          {operationsItems.map((item) => (
            <NavItem key={item.to} {...item} onNavigate={onNavigate} />
          ))}
        </div>

        {(canViewReports || canManageBreaks || isAdmin) && (
          <>
            <p className="px-3 pt-4 pb-1 text-[0.6875rem] font-semibold text-ink-faint">
              Management
            </p>
            <div className="space-y-0.5">
              {managementItems.map((item) => (
                <NavItem key={item.to} {...item} onNavigate={onNavigate} />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <p className="text-[0.6875rem] font-medium text-ink-dim">
          CC Version 1.0.0
        </p>
        <p className="text-[0.6875rem] text-ink-faint mt-0.5">
          © Naresh — All Rights Reserved
        </p>
      </div>
    </>
  );
}
