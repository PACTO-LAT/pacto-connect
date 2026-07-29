import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

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
}

/**
 * Parses a return URL matching `scheme` (a custom scheme like `myapp://` or a
 * universal-link prefix like `https://myapp.example/pacto-return`) into its
 * session/escrow query params. Returns `null` for URLs that don't match the
 * scheme or carry none of the expected params.
 */
export function parsePactoReturnUrl(url: string, scheme: string): PactoReturnLinkResult | null {
  if (!url.startsWith(scheme)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const sessionId = parsed.searchParams.get('sessionId') ?? undefined;
  const escrowId = parsed.searchParams.get('escrowId') ?? undefined;
  const status = parsed.searchParams.get('status') ?? undefined;

  if (!sessionId && !escrowId && !status) {
    return null;
  }

  return { sessionId, escrowId, status };
}

export interface UsePactoDeepLinkOptions {
  /** Custom scheme or universal-link prefix the checkout's `returnUrl` was set to. */
  scheme: string;
  enabled?: boolean;
  onReturn: (result: PactoReturnLinkResult) => void;
}

/**
 * Subscribes to `Linking` for the app's Pacto return link, covering both a
 * warm return (app resumed via `url` event) and a cold start (app launched by
 * tapping the link, surfaced only through `getInitialURL`).
 */
export function usePactoDeepLink(options: UsePactoDeepLinkOptions): void {
  const onReturnRef = useRef(options.onReturn);
  useEffect(() => {
    onReturnRef.current = options.onReturn;
  });

  const { scheme, enabled = true } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleUrl(url: string): void {
      const result = parsePactoReturnUrl(url, scheme);
      if (result) {
        onReturnRef.current(result);
      }
    }

    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));

    let cancelled = false;
    Linking.getInitialURL().then((url) => {
      if (!cancelled && url) {
        handleUrl(url);
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled, scheme]);
}
