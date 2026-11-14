import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.BACKOFFICE_PORT ?? 47831}`;

export default defineConfig({
  plugins: [svelte()],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    host: '127.0.0.1',
    port: 47832,
    strictPort: true,
    proxy: {
      '/api': api,
      '/ws': { target: api, ws: true },
    },
  },
});
