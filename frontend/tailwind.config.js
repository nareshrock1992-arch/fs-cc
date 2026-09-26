/** @type {import('tailwindcss').Config} */
// FS-CC Admin/Supervisor — colours are CSS-variable backed (source of truth:
// src/index.css :root + .dark). Opacity modifiers work via `/ <alpha-value>`.
// Legacy families (panel/ink/brand/lamp) are kept as aliases so existing
// markup keeps compiling; new code should prefer the semantic families.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Semantic surfaces / borders / text (canonical) ──────────────
        bg:      v('--bg'),
        surface: {
          DEFAULT: v('--surface'),
          2:       v('--surface-2'),
          raised:  v('--surface-raised'),
        },
        border: {
          DEFAULT: v('--border'),
          strong:  v('--border-strong'),
        },
        // ── Brand / intent ──────────────────────────────────────────────
        primary: {
          DEFAULT: v('--primary'),
          hover:   v('--primary-hover'),
        },
        success: v('--success'),
        warning: v('--warning'),
        danger:  v('--danger'),
        info:    v('--info'),
        focus:   v('--focus'),

        // ── Contact-center status family (crisp, no glow) ────────────────
        status: {
          available:  v('--status-available'),
          oncall:     v('--status-oncall'),
          ringing:    v('--status-ringing'),
          onbreak:    v('--status-onbreak'),
          loggedout:  v('--status-loggedout'),
          waiting:    v('--status-waiting'),
          abandoned:  v('--status-abandoned'),
          noanswer:   v('--status-noanswer'),
          error:      v('--status-error'),
        },

        // ── Text hierarchy (kept as `ink` to avoid the text-primary clash
        //    with the primary brand colour; shared with agent-desktop) ────
        ink: {
          DEFAULT: v('--text-primary'),
          dim:     v('--text-secondary'),
          faint:   v('--text-muted'),
          disabled:v('--text-disabled'),
        },

        // ── Legacy aliases (var-backed → theme-aware) ────────────────────
        panel: {
          bg:      v('--panel-bg'),
          surface: v('--panel-surface'),
          raised:  v('--panel-raised'),
          border:  v('--panel-border'),
          accent:  v('--panel-accent'),
        },
        brand: {
          DEFAULT: v('--primary'),
          dim:     v('--primary-hover'),
          light:   '#60A5FA',
        },
        lamp: {
          live:      v('--status-ringing'),
          available: v('--status-available'),
          break:     v('--status-onbreak'),
          loggedout: v('--status-loggedout'),
          alert:     v('--status-error'),
          ok:        v('--status-available'),
          warn:      v('--status-ringing'),
        },
      },
      fontFamily: {
        display: ['"IBM Plex Sans Condensed"', 'Inter', 'ui-sans-serif', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Subtle enterprise shadows only (Phase 2: glow "lamp" shadows removed)
        card:        '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.6)',
        'card-hover':'0 4px 16px rgba(0,0,0,0.12)',
      },
      borderRadius: {
        // Restrained enterprise scale: 6 / 8 / 12 / 16
        sm:      '6px',
        DEFAULT: '8px',
        md:      '8px',
        lg:      '12px',
        xl:      '12px',
        '2xl':   '16px',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 1.5s ease-out infinite',
        'slide-in-up':'slide-in-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
