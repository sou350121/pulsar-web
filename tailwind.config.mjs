/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind 4 scans content automatically when using the Vite plugin,
  // but we keep explicit globs for safety with Astro's island architecture.
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // --- Pulsar design tokens ---
        // Light mode values; dark-mode overrides live in CSS variables (global.css)
        'pulsar-bg':      'var(--color-bg)',
        'pulsar-surface': 'var(--color-surface)',
        'pulsar-border':  'var(--color-border)',
        'pulsar-text':    'var(--color-text)',
        'pulsar-muted':   'var(--color-muted)',
        'pulsar-amber':   'var(--color-amber)',
        'pulsar-cyan':    'var(--color-cyan)',
      },
      fontFamily: {
        // Serif body — elegant long-form reading
        lora:          ['Lora', 'Georgia', 'serif'],
        // Monospace — code, metrics, labels
        'ibm-plex-mono': ['"IBM Plex Mono"', '"Fira Mono"', 'monospace'],
        // CJK — Chinese content throughout the site
        'noto-serif-sc': ['"Noto Serif SC"', '"Source Han Serif SC"', 'serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'var(--color-text)',
            a: { color: 'var(--color-cyan)' },
            h1: { fontFamily: 'Lora, Georgia, serif' },
            h2: { fontFamily: 'Lora, Georgia, serif' },
          },
        },
      },
    },
  },
  plugins: [],
};
