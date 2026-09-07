import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
// Static frontend; API uses the same Worker in local simulation and production.
export default defineConfig({
  plugins: [vinext()],
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/assets': 'http://127.0.0.1:8787',
    },
  },
});
