import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/examples/marketplace/',
  build: {
    outDir: '../../public/examples/marketplace',
    emptyOutDir: true,
  },
  server: {
    port: 3203,
    strictPort: true,
  },
  preview: {
    port: 3203,
    strictPort: true,
  },
});
