import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true
      },
      '/audio': 'http://localhost:3000'
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
        display: resolve(import.meta.dirname, 'display.html'),
        host: resolve(import.meta.dirname, 'host.html'),
        guest: resolve(import.meta.dirname, 'guest.html')
      }
    }
  }
});
