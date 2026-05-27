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
          cyan:        '#00c8ff',
          'cyan-dim':  '#0090bb',
          teal:        '#00e5c8',
          blue:        '#1e90d4',
          'blue-light':'#4db8e8',
          'blue-dark': '#0f5a99',
          amber:       '#ffaa00',
          orange:      '#ff6b35',
          green:       '#00e676',
          'green-dim': '#4caf50',
          red:         '#ff4444',
        },
        hud: {
          border:       'rgba(0,200,255,0.18)',
          'border-mid': 'rgba(0,200,255,0.35)',
          'border-hi':  'rgba(0,200,255,0.65)',
          bg:           'rgba(4,12,24,0.97)',
          glow:         'rgba(0,200,255,0.08)',
          line:         'rgba(0,200,255,0.22)',
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
