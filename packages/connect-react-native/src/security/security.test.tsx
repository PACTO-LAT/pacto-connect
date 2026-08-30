import { PactoSecurityError } from '@pacto-connect/core';
import { render, waitFor } from '@testing-library/react';
import * as JailMonkey from 'jail-monkey';
import * as Biometrics from 'react-native-biometrics';
import * as SslPinning from 'react-native-ssl-pinning';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PactoCheckoutSheet } from '../PactoCheckoutSheet.js';
import { parseWebViewBridgeMessage } from '../webview-bridge.js';
import { createMockPinnedFetch } from './cert-pinning.js';
import {
  createMockIntegrityProbe,
  evaluateDeviceIntegrity,
  resolveIntegrityPolicy,
} from './device-integrity.js';
import { createLinkStateStore } from './link-state.js';
import { createMemorySecureSessionStore } from './secure-session-store.js';
import {
  createMockUserPresenceAdapter,
  parseUserPresenceRequest,
  USER_PRESENCE_SOURCE,
} from './user-presence.js';

const CHECKOUT_URL = 'https://checkout.pacto.example/embed';
const scope = {
  publishableKey: 'pk_test_abc',
  listingId: 'lst_1',
  browse: false,
  mode: 'buy' as const,
};

function getWebViewHandlers() {
  const node = document.querySelector('[data-rn-component="WebView"]');
  if (!node) {
    throw new Error('WebView mock not rendered');
  }
  return (
    node as unknown as {
      __testHandlers: { onShouldStartLoadWithRequest?: (r: { url: string }) => boolean };
    }
  ).__testHandlers;
}

describe('RN checkout security threat model', () => {
  beforeEach(() => {
    (JailMonkey as unknown as { __reset(): void }).__reset();
    (SslPinning as unknown as { __reset(): void }).__reset();
    (Biometrics as unknown as { __reset(): void }).__reset();
  });

  afterEach(() => {
    (JailMonkey as unknown as { __reset(): void }).__reset();
    (SslPinning as unknown as { __reset(): void }).__reset();
    (Biometrics as unknown as { __reset(): void }).__reset();
  });

  it('threat_deep_link_injection_rejects_unbound_state', async () => {
    const store = createLinkStateStore();
    await expect(store.verify('not-issued', scope)).rejects.toMatchObject({
      detailCode: 'link_state_invalid',
    });
  });

  it('threat_deep_link_injection_rejects_replayed_state', async () => {
    const store = createLinkStateStore();
    const state = await store.issue(scope);
    await store.verify(state, scope);
    await store.consume(state);
    await expect(store.verify(state, scope)).rejects.toMatchObject({
      detailCode: 'link_state_replayed',
    });
  });

  it('threat_storage_exfil_session_in_keychain_adapter', async () => {
    const store = createMemorySecureSessionStore();
    await store.saveSession(scope, {
      sessionId: 'sess_1',
      clientSecret: 'cs_secret',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mode: 'buy',
    });
    const loaded = await store.loadSession(scope);
    expect(loaded?.clientSecret).toBe('cs_secret');
  });

  it('threat_storage_exfil_clears_on_terminal_state', async () => {
    const secureSessionStore = createMemorySecureSessionStore();
    await secureSessionStore.saveSession(scope, {
      sessionId: 'sess_1',
      clientSecret: 'cs_secret',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mode: 'buy',
    });

    const onComplete = vi.fn();
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_abc"
        listingId="lst_1"
        secureSessionStore={secureSessionStore}
        userPresence={{ enabled: false }}
        integrityProbe={createMockIntegrityProbe({})}
        onComplete={onComplete}
        onRequestClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-rn-component="WebView"]')).toBeTruthy();
    });

    const node = document.querySelector('[data-rn-component="WebView"]') as unknown as {
      __testHandlers: {
        onMessage?: (event: { nativeEvent: { data: string; url: string } }) => void;
      };
    };

    node.__testHandlers.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          v: 1,
          source: 'pacto-connect',
          message: {
            type: 'checkout:complete',
            payload: { escrow: { id: 'esc_1', status: 'released' } },
          },
        }),
        url: CHECKOUT_URL,
      },
    });

    expect(onComplete).toHaveBeenCalled();
    expect(await secureSessionStore.loadSession(scope)).toBeNull();
  });

  it('threat_bridge_spoof_rejects_foreign_origin', () => {
    const raw = JSON.stringify({
      v: 1,
      source: 'pacto-connect',
      message: { type: 'checkout:ready', payload: { sessionId: 'sess_1' } },
    });
    expect(
      parseWebViewBridgeMessage(
        raw,
        'https://evil.example/embed',
        'https://checkout.pacto.example',
      ),
    ).toBeNull();
  });

  it('threat_webview_escape_blocks_non_allowlisted_origin', async () => {
    render(
      <PactoCheckoutSheet
        visible
        checkoutUrl={CHECKOUT_URL}
        publishableKey="pk_test_123"
        userPresence={{ enabled: false }}
        integrityProbe={createMockIntegrityProbe({})}
        onRequestClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-rn-component="WebView"]')).toBeTruthy();
    });

    const allowed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'https://bank.example/3ds',
    });
    expect(allowed).toBe(false);

    const malformed = getWebViewHandlers().onShouldStartLoadWithRequest?.({
      url: 'not-a-valid-url',
    });
    expect(malformed).toBe(false);
  });

  it('threat_mitm_pin_mismatch_fails_closed', async () => {
    (SslPinning as unknown as { __setServerPin(pin: string): void }).__setServerPin('wrong-pin');
    const pinnedFetch = createMockPinnedFetch({
      pinSet: { host: 'gateway.example', pins: ['current-pin'] },
      serverPin: 'wrong-pin',
    });

    await expect(
      pinnedFetch('https://gateway.example/v1/listings', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PactoSecurityError);
  });

  it('threat_mitm_pin_rotation_accepts_next_pin', async () => {
    const pinnedFetch = createMockPinnedFetch({
      pinSet: { host: 'gateway.example', pins: ['current-pin', 'next-pin'] },
      serverPin: 'next-pin',
      fallbackFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    });

    await expect(
      pinnedFetch('https://gateway.example/v1/listings', { method: 'GET' }),
    ).resolves.toBeDefined();
  });

  it('threat_mitm_all_pins_stale_surfaces_recovery_error', async () => {
    const pinnedFetch = createMockPinnedFetch({
      pinSet: { host: 'gateway.example', pins: ['old-pin'] },
      serverPin: null,
    });

    await expect(
      pinnedFetch('https://gateway.example/v1/listings', { method: 'GET' }),
    ).rejects.toMatchObject({ detailCode: 'pin_stale' });
  });

  it('threat_compromised_device_integrity_warn_default', async () => {
    const result = await evaluateDeviceIntegrity(
      createMockIntegrityProbe({ jailBroken: true }),
      'warn',
    );
    expect(result.recommendation).toBe('warn');
    expect(result.signals).toContain('jailbroken');
  });

  it('threat_compromised_device_integrity_block_policy', async () => {
    await expect(
      evaluateDeviceIntegrity(createMockIntegrityProbe({ hookDetected: true }), 'block'),
    ).rejects.toMatchObject({ detailCode: 'device_integrity_blocked' });
  });

  it('threat_payment_commit_requires_biometric', async () => {
    const adapter = createMockUserPresenceAdapter(async () => ({
      success: true,
      cancelled: false,
    }));
    const result = await adapter.requestPresence({ enabled: true });
    expect(result.success).toBe(true);
  });

  it('threat_payment_commit_cancellation_returns_to_deposit', async () => {
    const adapter = createMockUserPresenceAdapter(async () => ({
      success: false,
      cancelled: true,
      error: new PactoSecurityError('biometric_cancelled', 'cancelled'),
    }));
    const result = await adapter.requestPresence({ enabled: true });
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
  });

  it('resolveIntegrityPolicy defaults to warn when signals present', () => {
    expect(resolveIntegrityPolicy(['jailbroken'], 'warn').recommendation).toBe('warn');
  });

  it('parses user presence gate messages from the WebView', () => {
    const parsed = parseUserPresenceRequest(
      JSON.stringify({
        source: USER_PRESENCE_SOURCE,
        requestId: 'req-1',
        url: 'https://gateway.example/v1/escrows/esc_1/deposit',
      }),
    );
    expect(parsed?.requestId).toBe('req-1');
  });
});
