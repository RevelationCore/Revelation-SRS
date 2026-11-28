import path from 'path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ADR-026: /bff is this app's backend-for-frontend (apps/bff dev runs both).
    proxy: { '/bff': { target: 'http://localhost:3010', changeOrigin: false } },
  },
  resolve: {
    alias: {
      '@revelation-srs/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
