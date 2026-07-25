import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5175,
    cors: true,
  },
  resolve: {
    alias: {
      '@pacto-connect/core': path.resolve(__dirname, '../../../../packages/connect-core/dist/index.js'),
      '@pacto-connect/elements': path.resolve(__dirname, '../../../../packages/connect-elements/dist/index.js'),
    },
  },
});
