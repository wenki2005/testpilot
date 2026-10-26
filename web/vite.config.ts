import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: configDir,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4317',
      '/sample': 'http://127.0.0.1:4317',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
