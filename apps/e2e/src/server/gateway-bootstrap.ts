/**
 * Playwright globalSetup — runs after webServer is healthy, before any test.
 *
 * Provisions a test-mode API key that allows all E2E origins, then writes
 * the resulting config to a temp JSON file that fixtures read at test time.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? 'http://localhost:8788';
const ADMIN_TOKEN = process.env.GATEWAY_ADMIN_TOKEN ?? 'e2e-local-admin-secret';

// Origins the test API key must allow.
// 5174 = react-checkout Vite dev server
// 5175 = elements-checkout Vite dev server
// 5176 = synthetic origin used by headless Node.js SDK calls
const E2E_ORIGINS = [
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
];

export default async function globalSetup(): Promise<void> {
  await waitForGateway(GATEWAY_URL);

  const key = await createTestApiKey(ADMIN_TOKEN, E2E_ORIGINS);

  const configPath = path.join(tmpdir(), 'pacto-e2e-config.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        gatewayUrl: GATEWAY_URL,
        publishableKey: key.publishableKey,
        apiKeyId: key.id,
        adminToken: ADMIN_TOKEN,
      },
      null,
      2,
    ),
  );

  // Also expose as env vars so playwright.config.ts webServer env can reference them
  process.env.E2E_GATEWAY_URL = GATEWAY_URL;
  process.env.E2E_PUBLISHABLE_KEY = key.publishableKey;
  process.env.E2E_API_KEY_ID = key.id;
  process.env.E2E_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.E2E_CONFIG_PATH = configPath;

  console.log(`[e2e] Gateway ready at ${GATEWAY_URL}`);
  console.log(`[e2e] Test API key provisioned: ${key.publishableKey}`);
  console.log(`[e2e] Config written to: ${configPath}`);
}

async function waitForGateway(gatewayUrl: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${gatewayUrl}/health`);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await sleep(500);
  }
  throw new Error(`[e2e] Gateway did not become healthy at ${gatewayUrl} after ${maxAttempts} attempts`);
}

async function createTestApiKey(
  adminToken: string,
  allowedOrigins: string[],
): Promise<{ id: string; publishableKey: string }> {
  const res = await fetch(`${GATEWAY_URL}/admin/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      mode: 'test',
      allowedOrigins,
      label: 'e2e-test-key',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[e2e] Failed to create test API key (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { key: { id: string; publishableKey: string } };
  return body.key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
