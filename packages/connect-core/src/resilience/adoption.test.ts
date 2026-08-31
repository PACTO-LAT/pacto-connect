import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the "retryability comes from the taxonomy, not status codes"
 * acceptance criterion: none of the four adopting network modules may decide
 * whether to retry by inspecting an HTTP status code locally — that decision
 * must flow through `isRetryableError`/`isRetryableErrorCode`
 * (`errors.ts`/`taxonomy.ts`). Status-code inspection for *building* an
 * error (e.g. `errorFromResponse`'s classification) is fine; this only
 * forbids status-driven *retry* decisions in the network modules themselves.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url)).replace(/\/resilience$/, '');

const ADOPTING_MODULES = ['http.ts', 'sse.ts', 'escrow-events.ts', 'bridge.ts'];

// Matches the shapes a hand-rolled status-code retry check would take, e.g.
// `status >= 500`, `status === 429`, `response.status >= 500`.
const STATUS_CODE_RETRY_PATTERN = /\bstatus\s*(===|==|>=|<=|>|<)\s*(4|5)\d\d\b/;

describe('resilience adoption: no local status-code classification', () => {
  it.each(ADOPTING_MODULES)('%s does not branch retry logic on a raw status code', (file) => {
    const source = readFileSync(join(SRC_DIR, file), 'utf8');
    expect(source).not.toMatch(STATUS_CODE_RETRY_PATTERN);
  });

  it('http.ts and escrow-events.ts delegate retry decisions to the shared resilience policy', () => {
    const http = readFileSync(join(SRC_DIR, 'http.ts'), 'utf8');
    const escrowEvents = readFileSync(join(SRC_DIR, 'escrow-events.ts'), 'utf8');

    // http.ts hands every attempt to `ResiliencePolicy.execute`, which
    // classifies retryability internally via `isRetryableError` by default.
    expect(http).toMatch(/policy\.execute\(/);
    // escrow-events.ts makes its own reconnect-loop decision explicitly
    // against the shared policy's classifier rather than inlining a status check.
    expect(escrowEvents).toMatch(/policy\.isRetryable\(/);
  });
});
