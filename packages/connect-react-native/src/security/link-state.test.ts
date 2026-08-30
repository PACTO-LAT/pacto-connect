import { PactoSecurityError } from '@pacto-connect/core';
import { describe, expect, it } from 'vitest';
import { appendLinkState, createLinkStateStore, extractLinkStateFromUrl } from './link-state.js';

const scope = {
  publishableKey: 'pk_test_abc',
  listingId: 'lst_1',
  browse: false,
  mode: 'buy' as const,
};

describe('link state', () => {
  it('threat_deep_link_injection_rejects_unbound_state', async () => {
    const store = createLinkStateStore();
    await expect(store.verify('foreign-state-token', scope)).rejects.toBeInstanceOf(
      PactoSecurityError,
    );
    await expect(store.verify('foreign-state-token', scope)).rejects.toMatchObject({
      detailCode: 'link_state_invalid',
    });
  });

  it('threat_deep_link_injection_rejects_replayed_state', async () => {
    const store = createLinkStateStore();
    const state = await store.issue(scope, 'sess_1');
    await store.verify(state, scope, 'sess_1');
    await store.consume(state);

    await expect(store.verify(state, scope, 'sess_1')).rejects.toMatchObject({
      detailCode: 'link_state_replayed',
    });
  });

  it('issues and verifies a bound state token', async () => {
    const store = createLinkStateStore();
    const state = await store.issue(scope, 'sess_1');
    await expect(store.verify(state, scope, 'sess_1')).resolves.toBeUndefined();
  });

  it('appendLinkState adds state query param', () => {
    const url = appendLinkState('pacto-example://checkout-return', 'abc123');
    expect(extractLinkStateFromUrl(url)).toBe('abc123');
  });
});
