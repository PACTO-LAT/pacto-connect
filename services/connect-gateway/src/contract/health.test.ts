import { describe, it } from 'vitest';
import { createApp } from '../app.js';
import { expectResponseMatchesSpec } from './assert-response.js';

describe('contract: health route', () => {
  it('GET /health matches HealthResponse schema', async () => {
    const app = createApp();
    const res = await app.request('/health');

    await expectResponseMatchesSpec(res, { method: 'GET', path: '/health' });
  });
});
