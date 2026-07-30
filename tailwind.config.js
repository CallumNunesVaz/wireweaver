/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: 'var(--color-panel)',
        panelalt: 'var(--color-panelalt)',
        edge: 'var(--color-edge)',
        ink: 'var(--color-ink)',
        muted: 'var(--color-muted)',
        accent: 'var(--color-accent)'
      }
    }
  },
  plugins: []
}
