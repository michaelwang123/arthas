import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './src/popup/index.html'],
  theme: {
    extend: {
      colors: {
        background: '#111827',   // gray-900
        foreground: '#f3f4f6',   // gray-100
        accent: {
          blue: '#3b82f6',       // blue-500
          purple: '#8b5cf6',     // purple-500
        },
      },
    },
  },
  plugins: [],
} satisfies Config
