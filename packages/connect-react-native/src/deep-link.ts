import { PactoSecurityError } from '@pacto-connect/core';
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { extractLinkStateFromUrl, type LinkStateStore } from './security/link-state.js';

/**
 * Handles the app returning from an external payment step (e.g. a bank app or
 * 3-D Secure redirect) via a custom-scheme or universal link, independent of
 * whatever state the checkout WebView itself is in — the OS may have
 * suspended or backgrounded the app while the user was outside it.
 */

export interface PactoReturnLinkResult {
  sessionId?: string;
  escrowId?: string;
  status?: string;
  state?: string;
}

export interface ParsePactoReturnUrlOptions {
  /** When set, a valid unconsumed `state` query param is required. */
  requireState?: boolean;
}

/**
 * Parses a return URL matching `scheme` (a custom scheme like `myapp://` or a
 * universal-link prefix like `https://myapp.example/pacto-return`) into its
 * session/escrow query params. Returns `null` for URLs that don't match the
 * scheme or carry none of the expected params.
 */
export function parsePactoReturnUrl(
  url: string,
  scheme: string,
  options?: ParsePactoReturnUrlOptions,
): PactoReturnLinkResult | null {
  if (!url.startsWith(scheme)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const state = parsed.searchParams.get('state') ?? undefined;
  if (options?.requireState && !state) {
    throw new PactoSecurityError(
      'link_state_missing',
      'Return link is missing a required state parameter',
    );
  }

  const sessionId = parsed.searchParams.get('sessionId') ?? undefined;
  const escrowId = parsed.searchParams.get('escrowId') ?? undefined;
  const status = parsed.searchParams.get('status') ?? undefined;

  if (!sessionId && !escrowId && !status && !state) {
    return null;
  }

  return { sessionId, escrowId, status, state };
}

export interface VerifyPactoReturnLinkOptions {
  url: string;
  scheme: string;
  linkStateStore: LinkStateStore;
  scope: import('@pacto-connect/core').CheckoutSnapshotScope;
  sessionId?: string;
  requireState?: boolean;
}

/** Parses and verifies link state before returning deep-link params. */
export async function verifyPactoReturnLink(
  options: VerifyPactoReturnLinkOptions,
): Promise<PactoReturnLinkResult> {
  const result = parsePactoReturnUrl(options.url, options.scheme, {
    requireState: options.requireState ?? true,
  });

  if (!result) {
    throw new PactoSecurityError('link_state_malformed', 'Return link URL is malformed');
  }

  if (!result.state) {
    throw new PactoSecurityError(
      'link_state_missing',
      'Return link is missing a required state parameter',
    );
  }

  await options.linkStateStore.verify(result.state, options.scope, options.sessionId);
  await options.linkStateStore.consume(result.state);

  return result;
}

export interface UsePactoDeepLinkOptions {
  /** Custom scheme or universal-link prefix the checkout's `returnUrl` was set to. */
  scheme: string;
  enabled?: boolean;
  requireState?: boolean;
  linkStateStore?: LinkStateStore;
  scope?: import('@pacto-connect/core').CheckoutSnapshotScope;
  sessionId?: string;
  onReturn: (result: PactoReturnLinkResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Subscribes to `Linking` for the app's Pacto return link, covering both a
 * warm return (app resumed via `url` event) and a cold start (app launched by
 * tapping the link, surfaced only through `getInitialURL`).
 */
export function usePactoDeepLink(options: UsePactoDeepLinkOptions): void {
  const onReturnRef = useRef(options.onReturn);
  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onReturnRef.current = options.onReturn;
    onErrorRef.current = options.onError;
  });

  const { scheme, enabled = true, requireState, linkStateStore, scope, sessionId } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    async function handleUrl(url: string): Promise<void> {
      try {
        if (linkStateStore && scope) {
          const result = await verifyPactoReturnLink({
            url,
            scheme,
            linkStateStore,
            scope,
            sessionId,
            requireState: requireState ?? true,
          });
          onReturnRef.current(result);
          return;
        }

        const result = parsePactoReturnUrl(url, scheme, { requireState });
        if (result) {
          onReturnRef.current(result);
        }
      } catch (error) {
        if (error instanceof Error) {
          onErrorRef.current?.(error);
        }
      }
    }

    const subscription = Linking.addEventListener('url', (event) => {
      void handleUrl(event.url);
    });

    let cancelled = false;
    Linking.getInitialURL().then((url) => {
      if (!cancelled && url) {
        void handleUrl(url);
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled, scheme, requireState, linkStateStore, scope, sessionId]);
}

export { extractLinkStateFromUrl };
