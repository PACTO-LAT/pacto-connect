import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolvePactoEscrowTransport,
  statusToSyntheticEvent,
  usePactoEscrowEvents,
} from './escrow-events.js';

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

describe('statusToSyntheticEvent', () => {
  it('maps funded/released/disputed transitions to milestone events', () => {
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
  });

  it('returns null when the status has not changed', () => {
    expect(statusToSyntheticEvent('e1', 'funded', 'funded', '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('returns null for statuses with no milestone counterpart (pending/active/cancelled)', () => {
    expect(statusToSyntheticEvent('e1', null, 'pending', '2026-01-01T00:00:00Z')).toBeNull();
    expect(statusToSyntheticEvent('e1', 'pending', 'active', '2026-01-01T00:00:00Z')).toBeNull();
    expect(statusToSyntheticEvent('e1', 'active', 'cancelled', '2026-01-01T00:00:00Z')).toBeNull();
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('does nothing when disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => usePactoEscrowEvents({ ...baseOptions, enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
