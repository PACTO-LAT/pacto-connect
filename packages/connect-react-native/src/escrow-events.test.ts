import { act, renderHook } from '@testing-library/react';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSessionExpiringSoon,
  resolvePactoEscrowTransport,
  statusToSyntheticEvent,
  usePactoEscrowEvents,
} from './escrow-events.js';

function emitAppState(state: 'active' | 'background' | 'inactive'): void {
  (AppState as unknown as { __emit(state: string): void }).__emit(state);
}

describe('resolvePactoEscrowTransport', () => {
  it('respects a forced transport regardless of platform capability', () => {
    expect(resolvePactoEscrowTransport('polling')).toBe('polling');
    expect(resolvePactoEscrowTransport('sse')).toBe('sse');
  });

  it('auto-detects polling when ReadableStream is unavailable (typical Hermes/JSC)', () => {
    const original = globalThis.ReadableStream;
    (globalThis as { ReadableStream?: unknown }).ReadableStream = undefined;
    try {
      expect(resolvePactoEscrowTransport()).toBe('polling');
    } finally {
      globalThis.ReadableStream = original;
    }
  });

  it('auto-detects sse when ReadableStream is available', () => {
    expect(resolvePactoEscrowTransport()).toBe('sse');
  });
});

describe('isSessionExpiringSoon', () => {
  it('is true once expiresAt is within the margin', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(isSessionExpiringSoon(new Date(now + 10_000), 30_000, now)).toBe(true);
    expect(isSessionExpiringSoon(new Date(now - 1), 30_000, now)).toBe(true);
  });

  it('is false while comfortably outside the margin', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(isSessionExpiringSoon(new Date(now + 60_000), 30_000, now)).toBe(false);
  });
});

describe('statusToSyntheticEvent', () => {
  it('maps funded/released/disputed/cancelled/refunded transitions to milestone events', () => {
    expect(statusToSyntheticEvent('e1', 'active', 'funded', '2026-01-01T00:00:00Z')).toEqual({
      cursor: 'poll-e1-funded-2026-01-01T00:00:00Z',
      type: 'escrow.funded',
      escrowId: 'e1',
      milestone: 'funded',
      occurredAt: '2026-01-01T00:00:00Z',
    });
    expect(statusToSyntheticEvent('e1', 'funded', 'released', '2026-01-02T00:00:00Z')?.type).toBe(
      'released',
    );
    expect(statusToSyntheticEvent('e1', 'funded', 'disputed', '2026-01-02T00:00:00Z')?.type).toBe(
      'disputed',
    );
    expect(statusToSyntheticEvent('e1', 'pending', 'cancelled', '2026-01-02T00:00:00Z')?.type).toBe(
      'cancelled',
    );
    expect(statusToSyntheticEvent('e1', 'released', 'refunded', '2026-01-03T00:00:00Z')?.type).toBe(
      'refunded',
    );
  });

  it('returns null when the status has not changed', () => {
    expect(statusToSyntheticEvent('e1', 'funded', 'funded', '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('returns null for statuses with no milestone counterpart (pending/active)', () => {
    expect(statusToSyntheticEvent('e1', null, 'pending', '2026-01-01T00:00:00Z')).toBeNull();
    expect(statusToSyntheticEvent('e1', 'pending', 'active', '2026-01-01T00:00:00Z')).toBeNull();
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as Response;
}

describe('usePactoEscrowEvents (polling transport)', () => {
  const baseOptions = {
    publishableKey: 'pk_test_123',
    gatewayUrl: 'https://gateway.pacto.example',
    sessionId: 'sess_1',
    clientSecret: 'secret_1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'buy' as const,
    escrowId: 'escrow_1',
    transport: 'polling' as const,
    pollIntervalMs: 1000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    (AppState as unknown as { __reset(): void }).__reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (AppState as unknown as { __reset(): void }).__reset();
  });

  it('polls status and records a synthetic milestone on transition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: { id: 'escrow_1', status: 'funded', updatedAt: 't1' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() => usePactoEscrowEvents({ ...baseOptions, onEvent }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('active');
    expect(result.current.transport).toBe('polling');
    expect(result.current.milestones).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.status).toBe('funded');
    expect(result.current.milestones).toHaveLength(1);
    expect(result.current.milestones[0]?.milestone).toBe('funded');
    expect(onEvent).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('stops polling after unmount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => usePactoEscrowEvents(baseOptions));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    const callsAtUnmount = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it('surfaces a network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result, unmount } = renderHook(() =>
      usePactoEscrowEvents({ ...baseOptions, transport: 'polling', pollIntervalMs: 100_000 }),
    );

    // A rejected fetch is retried by connect-core's http client (default 3
    // attempts with backoff) before the hook surfaces the final error.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain('offline');
    unmount();
  });

  it('polls immediately when the app returns to the foreground, but not while backgrounded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() =>
      usePactoEscrowEvents({ ...baseOptions, pollIntervalMs: 100_000 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      emitAppState('background');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      emitAppState('active');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Foreground return polls right away instead of waiting out the
    // (deliberately huge) 100s interval.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('removes the AppState subscription on unmount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => usePactoEscrowEvents(baseOptions));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAtUnmount = fetchMock.mock.calls.length;

    unmount();

    act(() => {
      emitAppState('active');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it('refreshes an expiring session before polling and reports the new session', async () => {
    const refreshedExpiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(url.toString()).pathname;
      if (path === '/v1/session/refresh') {
        return jsonResponse({
          sessionId: 'sess_1',
          clientSecret: 'secret_2',
          expiresAt: refreshedExpiresAt,
          mode: 'buy',
        });
      }
      return jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSessionRefresh = vi.fn();
    const { unmount } = renderHook(() =>
      usePactoEscrowEvents({
        ...baseOptions,
        // Within the default 30s refresh margin.
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
        onSessionRefresh,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSessionRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess_1',
        clientSecret: 'secret_2',
        mode: 'buy',
      }),
    );
    const refreshCall = fetchMock.mock.calls.find(
      ([url]) => new URL(url.toString()).pathname === '/v1/session/refresh',
    );
    expect(refreshCall).toBeTruthy();

    unmount();
  });

  it('does not refresh a session that is not close to expiring', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: { id: 'escrow_1', status: 'active', updatedAt: 't0' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onSessionRefresh = vi.fn();
    const { unmount } = renderHook(() =>
      usePactoEscrowEvents({ ...baseOptions, onSessionRefresh }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSessionRefresh).not.toHaveBeenCalled();
    const refreshCall = fetchMock.mock.calls.find(
      ([url]) => new URL(url.toString()).pathname === '/v1/session/refresh',
    );
    expect(refreshCall).toBeFalsy();

    unmount();
  });

  it('does nothing when disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => usePactoEscrowEvents({ ...baseOptions, enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('usePactoEscrowEvents (sse transport)', () => {
  const baseOptions = {
    publishableKey: 'pk_test_123',
    gatewayUrl: 'https://gateway.pacto.example',
    sessionId: 'sess_1',
    clientSecret: 'secret_1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'buy' as const,
    escrowId: 'escrow_1',
    transport: 'sse' as const,
  };

  beforeEach(() => {
    (AppState as unknown as { __reset(): void }).__reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (AppState as unknown as { __reset(): void }).__reset();
  });

  it('forwards the `resilience` option to Pacto.init() and surfaces a stream failure via onStreamError as the hook error state', async () => {
    // Every connection attempt fails (no `.body`), driving the subscriber
    // to give up quickly via a tiny `maxReconnectAttempts`.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({})),
    );

    const { result, unmount } = renderHook(() =>
      usePactoEscrowEvents({
        ...baseOptions,
        resilience: { maxReconnectAttempts: 1, baseDelayMs: 1 },
      }),
    );

    await vi.waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.transport).toBe('sse');

    unmount();
  });
});
