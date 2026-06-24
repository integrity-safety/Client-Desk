import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the built assets resolve correctly when served at the subdomain root.
// The dev proxy lets `npm run dev` talk to a local PHP API at :8000 during development.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
