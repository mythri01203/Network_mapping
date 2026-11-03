/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        telecom: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc5fb',
          400: '#36a4f7',
          500: '#0c87eb',
          600: '#006ac9',
          700: '#0155a3',
          800: '#064886',
          900: '#0b3d6f',
        },
        fiber: {
          blue: '#0284c7',
          orange: '#ea580c',
          green: '#16a34a',
          brown: '#78350f',
          slate: '#64748b',
          white: '#e2e8f0',
          red: '#dc2626',
          black: '#1e293b',
          yellow: '#ca8a04',
          violet: '#7c3aed',
          rose: '#e11d48',
          aqua: '#06b6d4',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
