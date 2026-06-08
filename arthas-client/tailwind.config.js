/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#1a0a2e',
        dawn: '#ffd700',
        ash: '#8b4513',
      },
      keyframes: {
        'pulse-banner': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'pulse-once': {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.6' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-msg': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'shrink-bar': {
          from: { width: '100%' },
          to: { width: '0%' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px var(--glow-color, rgba(99,102,241,0.3))' },
          '50%': { boxShadow: '0 0 20px var(--glow-color, rgba(99,102,241,0.6))' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
      animation: {
        'pulse-banner': 'pulse-banner 2s ease-in-out infinite',
        'pulse-once': 'pulse-once 0.3s ease-in-out 1',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'slide-in-msg': 'slide-in-msg 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
        'shimmer': 'shimmer 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
