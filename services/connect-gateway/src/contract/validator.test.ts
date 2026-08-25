import { describe, expect, it } from 'vitest';
import { loadOpenApiSpec } from './load-spec.js';
import { validateAgainstSchema } from './assert-response.js';

describe('contract: response validator', () => {
  it('rejects a success body missing a required field', async () => {
    const spec = await loadOpenApiSpec();
    const sessionSchema = spec.components?.schemas?.SessionResponse;

    expect(sessionSchema).toBeDefined();

    const validBody = {
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_signature',
      expiresAt: '2024-01-01T00:15:00.000Z',
      mode: 'buy',
    };

    const tamperedBody = { ...validBody };
    delete (tamperedBody as { sessionId?: string }).sessionId;

    expect(validateAgainstSchema(sessionSchema, validBody).valid).toBe(true);
    expect(validateAgainstSchema(sessionSchema, tamperedBody).valid).toBe(false);
  });
});
