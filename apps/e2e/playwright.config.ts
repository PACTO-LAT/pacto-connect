import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? 'http://localhost:8788';

export default defineConfig({
  testDir: './src/tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  // globalSetup provisions the test API key before tests run.
  // webServer starts FIRST (Playwright ensures gateway is healthy), then globalSetup runs.
  globalSetup: './src/server/gateway-bootstrap.ts',

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  webServer: [
    {
      // Gateway — must be built before running (turbo build handles this)
      command: 'node dist/index.js',
      cwd: path.resolve(__dirname, '../../services/connect-gateway'),
      url: `${GATEWAY_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: {
        PORT: '8788',
        NODE_ENV: 'test',
        // In CI these come from the job env. Locally, set them in your shell
        // or create services/connect-gateway/.env.test and source it before running.
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgresql://pacto:pacto@localhost:5432/pacto_e2e',
        DIRECT_URL:
          process.env.DIRECT_URL ?? 'postgresql://pacto:pacto@localhost:5432/pacto_e2e',
        GATEWAY_ADMIN_TOKEN: process.env.GATEWAY_ADMIN_TOKEN ?? 'e2e-local-admin-secret',
        GATEWAY_SIGNING_SECRET:
          process.env.GATEWAY_SIGNING_SECRET ?? 'e2e-local-signing-secret-32chars!',
        TESTMODE_RELEASE_DELAY_MS: '500',
        WEBHOOK_BACKOFF_BASE_MS: '100',
      },
    },
    {
      // React dev server for connect-react tests
      command: 'npx vite --port 5174',
      cwd: path.join(__dirname, 'src/pages/react-checkout'),
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      // Vite dev server for connect-elements tests (web component, no iframe)
      command: 'npx vite --port 5175',
      cwd: path.join(__dirname, 'src/pages/elements-checkout'),
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
