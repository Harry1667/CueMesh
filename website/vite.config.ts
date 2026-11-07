import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Shared with the extension's deployed default; override for a local server.
const apiProxy = {
  '/api': {
    target: process.env.CUEMESH_API_TARGET || 'https://cuemesh.looptw.com',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { sourcemap: false },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
