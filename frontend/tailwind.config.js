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
      // Large-monitor tier (QHD/4K). One documented breakpoint — used only to
      // widen the content container so supervisor monitors ≥2560px use the extra
      // horizontal space, without introducing per-page breakpoint hacks. Default
      // Tailwind breakpoints (sm…2xl) are preserved via `extend`.
      screens: {
        '3xl': '2560px',
        // Viewport is both wide AND tall enough for panels to own an internal
        // scroll area (sticky table headers). Below this — short windows or
        // high browser zoom — tables grow naturally and the page scrolls, so
        // rows are never trapped in a tiny scroll box.
        tall: { raw: '(min-width: 64rem) and (min-height: 44rem)' },
      },
      colors: {
        // ── Neutral ramp (UI modernization) ─────────────────────────────
        // Replaces Tailwind's default gray so the ~430 hardcoded `gray-*`
        // utilities across pages follow the design palette instead of the
        // stock cool-grey. Anchored on the tokens: 200 = border, 400 = muted
        // text (≥4.5:1 on white, was 2.5:1), 500 = secondary text, 900 = ink.
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
        navy: v('--brand-navy'),

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
          light:   v('--primary'),
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
        // One typeface for the whole product. `display` is kept as an alias so
        // existing `font-display` headings render in Inter instead of the
        // condensed face (which read as cramped at small sizes).
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono:    ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'], // one typeface; digits via tabular-nums (index.css)
      },
      boxShadow: {
        // Restrained enterprise elevation: cards are near-flat and rely on a
        // crisp hairline border; real elevation is reserved for overlays.
        card:        '0 1px 2px rgba(20,38,61,0.05)',
        'card-dark': '0 1px 2px rgba(0,0,0,0.45)',
        'card-hover':'0 8px 24px rgba(20,38,61,0.12)',
      },
      borderRadius: {
        // Restrained enterprise scale: controls & cards 8px, overlays 10–12px.
        // (lg/xl tightened from 12px so existing `rounded-lg/xl` usages across
        // pages converge on the 8px design radius without per-file edits.)
        sm:      '6px',
        DEFAULT: '8px',
        md:      '8px',
        lg:      '8px',
        xl:      '10px',
        '2xl':   '12px',
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
