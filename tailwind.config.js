/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--rgb-bg) / <alpha-value>)',
        panel: 'rgb(var(--rgb-panel) / <alpha-value>)',
        panelalt: 'rgb(var(--rgb-panelalt) / <alpha-value>)',
        edge: 'rgb(var(--rgb-edge) / <alpha-value>)',
        ink: 'rgb(var(--rgb-ink) / <alpha-value>)',
        muted: 'rgb(var(--rgb-muted) / <alpha-value>)',
        accent: 'rgb(var(--rgb-accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--rgb-accent-ink) / <alpha-value>)',
        danger: 'rgb(var(--rgb-danger) / <alpha-value>)',
        warn: 'rgb(var(--rgb-warn) / <alpha-value>)',
        success: 'rgb(var(--rgb-success) / <alpha-value>)',
        neutral: 'rgb(var(--rgb-neutral) / <alpha-value>)'
      }
    }
  },
  plugins: []
}
