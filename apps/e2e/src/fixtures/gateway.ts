import { test as base } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface E2EConfig {
  gatewayUrl: string;
  publishableKey: string;
  apiKeyId: string;
  adminToken: string;
}

function readConfig(): E2EConfig {
  const configPath = process.env.E2E_CONFIG_PATH;
  if (!configPath) {
    throw new Error('[e2e] E2E_CONFIG_PATH is not set. Did globalSetup run?');
  }
  return JSON.parse(readFileSync(configPath, 'utf-8')) as E2EConfig;
}

export interface GatewayFixtures {
  gatewayUrl: string;
  publishableKey: string;
  apiKeyId: string;
  adminToken: string;
}

export const test = base.extend<GatewayFixtures>({
  gatewayUrl: async ({}, use) => {
    await use(readConfig().gatewayUrl);
  },
  publishableKey: async ({}, use) => {
    await use(readConfig().publishableKey);
  },
  apiKeyId: async ({}, use) => {
    await use(readConfig().apiKeyId);
  },
  adminToken: async ({}, use) => {
    await use(readConfig().adminToken);
  },
});
