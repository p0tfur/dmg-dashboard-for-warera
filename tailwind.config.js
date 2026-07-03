/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/components/**/*.{vue,js,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/app.vue',
    './app/app.config.{js,ts}',
    './content/**/*.{md,json}',
  ],
  theme: {
    extend: {
      colors: {
        // Tactical Command Center palette
        base: {
          950: '#0A0D11',
          900: '#0E1116',
          850: '#12161C',
          800: '#161B22',
          750: '#1B2129',
          700: '#222932',
          600: '#2E3742',
          500: '#3B4550',
        },
        fed: {
          DEFAULT: '#F5A524',
          glow: '#FFC04D',
          dim: '#7A5310',
        },
        just: {
          DEFAULT: '#22D3EE',
          glow: '#67E8F9',
          dim: '#0E7490',
        },
        live: '#22C55E',
        danger: '#EF4444',
      },
      fontFamily: {
        display: ['"Saira Condensed"', '"Inter Tight"', 'sans-serif'],
        sans: ['"Inter Tight"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-fed': '0 0 24px -6px rgba(245, 165, 36, 0.45)',
        'glow-just': '0 0 24px -6px rgba(34, 211, 238, 0.45)',
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 0 0 1px rgba(255,255,255,0.04)',
      },
      backgroundImage: {
        'scanlines':
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 3px)',
        'grid':
          'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.85)' },
        },
        'shimmer': {
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
        'shimmer': 'shimmer 1.6s infinite',
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
}
