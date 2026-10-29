import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server (server/index.ts) owns /api/*. During local development Vite
// proxies those calls to it; in production Express serves the built app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
