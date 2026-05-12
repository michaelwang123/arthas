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
    },
  },
  plugins: [],
}
