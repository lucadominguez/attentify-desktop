/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/*.html'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#050d18',
          900: '#080f1e',
          850: '#0a1628',
          800: '#0d1b2a',
          750: '#0f2035',
          700: '#112240',
          600: '#163050',
          500: '#1e3a5f',
          400: '#2a4f7a',
          300: '#3d6494',
        },
        accent: {
          blue: '#2196f3',
          'blue-light': '#42a5f5',
          'blue-dark': '#1565c0',
          amber: '#ffb800',
          orange: '#ff6b35',
          green: '#4caf50',
          'green-light': '#66bb6a',
          red: '#ef4444',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in-right': 'slideInRight 0.35s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        scan: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(8px)' },
        }
      }
    },
  },
  plugins: [],
}
