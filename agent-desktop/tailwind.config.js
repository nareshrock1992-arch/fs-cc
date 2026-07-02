/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          bg:      '#060B17',
          surface: '#0B1220',
          raised:  '#111B2E',
          border:  '#1C2A42',
          accent:  '#1E3A6E',
        },
        ink: {
          DEFAULT: '#E8ECF6',
          dim:     '#8B99B8',
          faint:   '#4C5A78',
        },
        lamp: {
          live:      '#F5A623',
          available: '#27C98A',
          break:     '#4C8EF5',
          loggedout: '#4C5A78',
          alert:     '#EF4444',
        },
        brand: {
          DEFAULT: '#2563EB',
          dim:     '#1E4FB5',
          light:   '#60A5FA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card:        '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.6)',
        'card-hover':'0 4px 12px rgba(0,0,0,0.6)',
        'lamp-green':'0 0 8px 2px rgba(39,201,138,0.4)',
        'lamp-amber':'0 0 8px 2px rgba(245,166,35,0.4)',
        'lamp-red':  '0 0 8px 2px rgba(239,68,68,0.4)',
        'lamp-blue': '0 0 8px 2px rgba(76,142,245,0.4)',
      },
      borderRadius: {
        sm:      '3px',
        DEFAULT: '6px',
        lg:      '10px',
        xl:      '14px',
      },
    },
  },
  plugins: [],
};
