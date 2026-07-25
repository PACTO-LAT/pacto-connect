import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Allow the gateway origin for SSE fetch from the browser
    cors: true,
  },
  resolve: {
    // Point to built dist files so the test uses the real compiled output.
    // Packages must be built before running E2E (turbo handles this via dependsOn ^build).
    alias: {
      '@pacto-connect/core': path.resolve(__dirname, '../../../../packages/connect-core/dist/index.js'),
      '@pacto-connect/react': path.resolve(__dirname, '../../../../packages/connect-react/dist/index.js'),
    },
  },
});
