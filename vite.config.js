import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Multi-page application: Vite needs to know about all HTML entry points
  build: {
    rollupOptions: {
      input: {
        main:        resolve(import.meta.dirname, 'index.html'),
        runner:      resolve(import.meta.dirname, 'subway-surfers.html'),
        drinkSort:   resolve(import.meta.dirname, 'drink-sort.html'),
      },
    },
  },
  server: {
    // In dev mode, proxy socket.io to the express server
    proxy: {
      '/socket.io': {
        target:    'http://localhost:3000',
        ws:        true,
        changeOrigin: true,
      },
    },
  },
});
