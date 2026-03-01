import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://sou350121.github.io/pulsar-web',
  output: 'static',
  integrations: [
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    // Enable shiki for code highlighting inside markdown pages
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
