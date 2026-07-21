import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    ...(process.env.VITE_DEV_HOST ? { host: process.env.VITE_DEV_HOST } : {}),
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000', ws: true },
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
