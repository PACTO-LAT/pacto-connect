import { act, renderHook } from '@testing-library/react';
import { Linking } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePactoReturnUrl, usePactoDeepLink } from './deep-link.js';

describe('parsePactoReturnUrl', () => {
  it('parses sessionId/escrowId/status from a matching custom-scheme URL', () => {
    const result = parsePactoReturnUrl(
      'pacto-example://checkout-return?sessionId=sess_1&escrowId=esc_1&status=released',
      'pacto-example://',
    );
    expect(result).toEqual({ sessionId: 'sess_1', escrowId: 'esc_1', status: 'released' });
  });

  it('returns null for a URL that does not match the scheme', () => {
    const result = parsePactoReturnUrl(
      'other-app://checkout-return?sessionId=sess_1',
      'pacto-example://',
    );
    expect(result).toBeNull();
  });

  it('matches a universal-link https prefix', () => {
    const result = parsePactoReturnUrl(
      'https://myapp.example/pacto-return?status=disputed',
      'https://myapp.example/pacto-return',
    );
    expect(result).toEqual({ sessionId: undefined, escrowId: undefined, status: 'disputed' });
  });

  it('returns null when the URL matches the scheme but carries none of the expected params', () => {
    const result = parsePactoReturnUrl('pacto-example://checkout-return', 'pacto-example://');
    expect(result).toBeNull();
  });

  it('returns null for an unparsable URL', () => {
    expect(parsePactoReturnUrl('not a url', 'pacto-example://')).toBeNull();
  });
});

describe('usePactoDeepLink', () => {
  beforeEach(() => {
    (Linking as unknown as { __reset(): void }).__reset();
  });

  afterEach(() => {
    (Linking as unknown as { __reset(): void }).__reset();
  });

  it('invokes onReturn for a warm `url` event matching the scheme', () => {
    const onReturn = vi.fn();
    renderHook(() => usePactoDeepLink({ scheme: 'pacto-example://', onReturn }));

    act(() => {
      (Linking as unknown as { __emit(url: string): void }).__emit(
        'pacto-example://checkout-return?status=released',
      );
    });

    expect(onReturn).toHaveBeenCalledWith({
      sessionId: undefined,
      escrowId: undefined,
      status: 'released',
    });
  });

  it('ignores warm events for a different scheme', () => {
    const onReturn = vi.fn();
    renderHook(() => usePactoDeepLink({ scheme: 'pacto-example://', onReturn }));

    act(() => {
      (Linking as unknown as { __emit(url: string): void }).__emit(
        'other-app://checkout-return?status=released',
      );
    });

    expect(onReturn).not.toHaveBeenCalled();
  });

  it('picks up a cold-start initial URL', async () => {
    (Linking as unknown as { __setInitialURL(url: string): void }).__setInitialURL(
      'pacto-example://checkout-return?sessionId=sess_1',
    );
    const onReturn = vi.fn();

    renderHook(() => usePactoDeepLink({ scheme: 'pacto-example://', onReturn }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onReturn).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      escrowId: undefined,
      status: undefined,
    });
  });

  it('does nothing when disabled', () => {
    const onReturn = vi.fn();
    renderHook(() => usePactoDeepLink({ scheme: 'pacto-example://', enabled: false, onReturn }));

    act(() => {
      (Linking as unknown as { __emit(url: string): void }).__emit(
        'pacto-example://checkout-return?status=released',
      );
    });

    expect(onReturn).not.toHaveBeenCalled();
  });
});
