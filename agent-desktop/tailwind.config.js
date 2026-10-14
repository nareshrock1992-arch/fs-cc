/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // All theme-sensitive colors are CSS-variable backed.
      // Light values live in :root, dark values in .dark — defined in index.css.
      // Opacity modifiers (bg-panel-bg/50) work because of the /alpha-value syntax.
      colors: {
        // ── FS-CC canonical semantic families (shared with Admin) ────────
        bg:      'rgb(var(--bg)      / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface)        / <alpha-value>)',
          2:       'rgb(var(--surface-2)      / <alpha-value>)',
          raised:  'rgb(var(--surface-raised) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border)        / <alpha-value>)',
          strong:  'rgb(var(--border-strong) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary)       / <alpha-value>)',
          hover:   'rgb(var(--primary-hover) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger:  'rgb(var(--danger)  / <alpha-value>)',
        info:    'rgb(var(--info)    / <alpha-value>)',
        focus:   'rgb(var(--focus)   / <alpha-value>)',
        status: {
          available: 'rgb(var(--status-available) / <alpha-value>)',
          oncall:    'rgb(var(--status-oncall)    / <alpha-value>)',
          ringing:   'rgb(var(--status-ringing)   / <alpha-value>)',
          onbreak:   'rgb(var(--status-onbreak)   / <alpha-value>)',
          loggedout: 'rgb(var(--status-loggedout) / <alpha-value>)',
          waiting:   'rgb(var(--status-waiting)   / <alpha-value>)',
          abandoned: 'rgb(var(--status-abandoned) / <alpha-value>)',
          noanswer:  'rgb(var(--status-noanswer)  / <alpha-value>)',
          error:     'rgb(var(--status-error)     / <alpha-value>)',
        },
        panel: {
          bg:      'rgb(var(--panel-bg)      / <alpha-value>)',
          surface: 'rgb(var(--panel-surface) / <alpha-value>)',
          raised:  'rgb(var(--panel-raised)  / <alpha-value>)',
          border:  'rgb(var(--panel-border)  / <alpha-value>)',
          accent:  'rgb(var(--panel-accent)  / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink)       / <alpha-value>)',
          dim:     'rgb(var(--ink-dim)   / <alpha-value>)',
          faint:   'rgb(var(--ink-faint) / <alpha-value>)',
        },
        // Lamp / status colours — token-backed so they match the Admin app
        // and adapt to dark mode.
        lamp: {
          live:      'rgb(var(--status-ringing)   / <alpha-value>)',
          available: 'rgb(var(--status-available) / <alpha-value>)',
          break:     'rgb(var(--status-onbreak)   / <alpha-value>)',
          loggedout: 'rgb(var(--status-loggedout) / <alpha-value>)',
          alert:     'rgb(var(--status-error)     / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--primary)       / <alpha-value>)',
          dim:     'rgb(var(--primary-hover) / <alpha-value>)',
          light:   'rgb(var(--primary)       / <alpha-value>)',
        },
        navy: 'rgb(var(--brand-navy) / <alpha-value>)',
        // Neutral ramp — identical to frontend/tailwind.config.js.
        gray: {
          50:  '#F5F7FA',
          100: '#EDF1F6',
          200: '#DCE4ED',
          300: '#B9C4D2',
          400: '#66758A',
          500: '#526176',
          600: '#445268',
          700: '#33415A',
          800: '#232F44',
          900: '#172334',
          950: '#0E1724',
        },
      },
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono:    ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'], // one typeface; digits via tabular-nums (index.css)
      },
      boxShadow: {
        card:          '0 1px 2px rgba(20,38,61,0.05)',
        'card-dark':   '0 1px 2px rgba(0,0,0,0.45)',
        'card-hover':  '0 8px 24px rgba(20,38,61,0.12)',
      },
      borderRadius: {
        sm:      '6px',
        DEFAULT: '8px',
        lg:      '8px',
        xl:      '10px',
      },
    },
  },
  plugins: [],
};
