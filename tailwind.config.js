/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/*.html'],
  theme: {
    extend: {
      colors: {
        // Void-black backgrounds — cooler and deeper than before
        navy: {
          950: '#010810',
          900: '#020912',
          850: '#040d1a',
          800: '#060f1e',
          750: '#081525',
          700: '#0a1c30',
          600: '#0d2238',
          500: '#142e4a',
          400: '#1e3f60',
          300: '#28526e',
        },
        accent: {
          cyan:        '#6366f1',
          'cyan-dim':  '#4f46e5',
          teal:        '#34d399',
          blue:        '#3b9eff',
          'blue-light':'#60b8ff',
          'blue-dark': '#0f5a99',
          amber:       '#fbbf24',
          orange:      '#ff6b35',
          green:       '#34d399',
          'green-dim': '#34d399',
          red:         '#f87171',
        },
        hud: {
          border:       'rgba(99,102,241,0.18)',
          'border-mid': 'rgba(99,102,241,0.35)',
          'border-hi':  'rgba(99,102,241,0.65)',
          bg:           'rgba(4,12,24,0.97)',
          glow:         'rgba(99,102,241,0.08)',
          line:         'rgba(99,102,241,0.22)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Share Tech Mono"', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      animation: {
        'fade-in':       'fadeIn 0.25s ease-out',
        'slide-in-right':'slideInRight 0.3s ease-out',
        'pulse-slow':    'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        'glow-pulse':    'glowPulse 2.5s ease-in-out infinite',
        'bracket-in':    'bracketIn 0.18s ease-out',
        'scan-h':        'scanH 3.5s linear infinite',
        'float':         'float 6s ease-in-out infinite',
        'entry-slide':   'entrySlide 0.32s ease-out forwards',
        'dot-pulse':     'dotPulse 2s ease-in-out infinite',
        'bar-fill':      'barFill 0.75s cubic-bezier(0.4,0,0.2,1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        glowPulse: {
          '0%,100%': { opacity: '0.55' },
          '50%':     { opacity: '1' },
        },
        bracketIn: {
          '0%':   { opacity: '0', transform: 'scale(0.7)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        scanH: {
          '0%':   { transform: 'translateX(-100%)', opacity: '0' },
          '8%':   { opacity: '1' },
          '92%':  { opacity: '1' },
          '100%': { transform: 'translateX(100vw)', opacity: '0' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%':     { transform: 'translateY(-6px)' },
        },
      },
    },
  },
  plugins: [],
}
