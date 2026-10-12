import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Local dev: Vite serves the SPA and proxies API calls to `wrangler dev`.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
