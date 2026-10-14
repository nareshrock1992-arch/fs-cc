import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PageHeader from '../PageHeader.jsx';
import { pageMetaFor } from '../../lib/pageMeta.js';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('cc-theme');
    if (saved) return saved === 'dark';
  } catch {}
  return false; // default: light (FS-CC is light-first)
}

export default function Layout() {
  const [isDark, setIsDark] = useState(getInitialTheme);
  const { pathname } = useLocation();
  const meta = pageMetaFor(pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try { localStorage.setItem('cc-theme', isDark ? 'dark' : 'light'); } catch {}
  }, [isDark]);

  const toggleTheme = () => setIsDark((d) => !d);

  // Navigation drawer (below `md` — small windows / high browser zoom).
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  useEffect(() => { setNavOpen(false); }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-bg text-ink antialiased">
      <Sidebar mobileOpen={navOpen} onClose={closeNav} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar isDark={isDark} toggleTheme={toggleTheme} onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Standardized enterprise content container: wide for information
              density, centered, consistent gutters. (Phase 3A.6) */}
          {/* Adaptive content width: 1600px on standard desktops (1366–2559 →
              unchanged), widening to 2240px only on ≥2560px monitors so QHD/4K
              use the extra space while keeping bounded, readable line lengths. */}
          <div className="mx-auto w-full max-w-[1600px] 3xl:max-w-[2240px] px-4 md:px-6 3xl:px-8 py-4 md:py-5">
            {/* Title AND description live in the Topbar (one compact header for
                every page). Below `lg`, where the Topbar hides the description
                to keep the title clear of the status/user controls, show it
                here instead. */}
            <div className="lg:hidden"><PageHeader description={meta.description} /></div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
