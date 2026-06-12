/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand:   { DEFAULT: '#4C6FFF' },
        surface: { page: '#F4F6F9', card: '#FFFFFF', border: '#E5E9F0' },
        neutral: { primary: '#1A1F2B', muted: '#8A93A6' },
        profit:  { bg: '#ECFBF4', border: '#CFF3E3', text: '#0E7A53', label: '#189A6B', chart: '#2ECC91' },
        loss:    { bg: '#FFF3F3', border: '#FAD8D8', text: '#C24545', chart: '#FF6B6B' },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
