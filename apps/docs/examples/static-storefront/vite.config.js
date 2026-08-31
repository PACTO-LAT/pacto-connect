import { defineConfig } from 'vite';

export default defineConfig({
  base: '/examples/static/',
  build: {
    outDir: '../../public/examples/static',
    emptyOutDir: true,
  },
  server: {
    port: 3202,
    strictPort: true,
  },
  preview: {
    port: 3202,
    strictPort: true,
  },
});
