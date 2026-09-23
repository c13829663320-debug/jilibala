import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API exposes its liveness route at /health (no /api prefix); alias it
      // so the frontend can probe it through the same /api origin.
      '/api/health': { target: 'http://localhost:8787', rewrite: () => '/health' },
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
