/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#1b1e24',
        panelalt: '#232730',
        edge: '#2f343f',
        ink: '#e7e9ee',
        muted: '#9aa1ad',
        accent: '#5b9bff'
      }
    }
  },
  plugins: []
}
