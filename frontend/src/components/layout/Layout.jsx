import { useEffect, useState } from 'react';
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

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-bg text-ink antialiased">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar isDark={isDark} toggleTheme={toggleTheme} />
        <main className="flex-1 overflow-y-auto">
          {/* Standardized enterprise content container: wide for information
              density, centered, consistent gutters. (Phase 3A.6) */}
          <div className="mx-auto w-full max-w-[1600px] px-6 py-5">
            {/* Title lives in the Topbar; this header carries context (description)
                + future page actions, so the title is not repeated underneath. */}
            <PageHeader description={meta.description} />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
