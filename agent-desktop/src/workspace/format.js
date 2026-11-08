import { useEffect, useState } from 'react';

/** mm:ss, or h:mm:ss after an hour. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Seconds elapsed since `start` (epoch ms, ISO string or Date); ticks every second. */
export function useElapsed(start) {
  const startMs = start ? new Date(start).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startMs) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);
  return startMs ? Math.max(0, (now - startMs) / 1000) : 0;
}

/** Remembers when a value first became truthy (e.g. ring start); resets when it goes falsy. */
export function useSince(active, key) {
  const [since, setSince] = useState(null);
  useEffect(() => {
    setSince(active ? Date.now() : null);
  }, [active, key]);
  return since;
}

export function formatClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
