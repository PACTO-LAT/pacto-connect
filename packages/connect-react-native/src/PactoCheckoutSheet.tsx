import type {
  CheckoutMode,
  CheckoutStep,
  CheckoutStorageAdapter,
  Escrow,
  FetchLike,
  PactoError,
} from '@pacto-connect/core';
import {
  type CheckoutSnapshot,
  DEFAULT_BRIDGE_MESSAGE_TIMEOUT_MS,
  PactoTimeoutError,
  parseCheckoutSnapshot,
  serializeCheckoutSnapshot,
  snapshotMatchesScope,
} from '@pacto-connect/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import {
  buildCheckoutSnapshotScope,
  checkoutStorageKey,
  createDefaultReactNativeCheckoutStorage,
  isCheckoutSnapshotExpired,
} from './checkout-storage.js';
import type { PinSet } from './security/cert-pinning.js';
import { createPinnedFetch } from './security/cert-pinning.js';
import {
  createJailMonkeyIntegrityProbe,
  DEFAULT_INTEGRITY_POLICY,
  evaluateDeviceIntegrity,
  type IntegrityPolicy,
  type IntegrityProbe,
} from './security/device-integrity.js';
import type { LinkStateStore } from './security/link-state.js';
import { createLinkStateStore } from './security/link-state.js';
import {
  createDefaultSecureSessionStore,
  createMemorySecureSessionStore,
  type SecureSessionStoreAdapter,
} from './security/secure-session-store.js';
import {
  buildUserPresenceAbortScript,
  buildUserPresenceContinuationScript,
  createBiometricsUserPresenceAdapter,
  parseUserPresenceRequest,
  USER_PRESENCE_GATE_SCRIPT,
  type UserPresenceAdapter,
  type UserPresenceOptions,
} from './security/user-presence.js';
import {
  BRIDGE_SHIM_SCRIPT,
  buildCheckoutStorageSeedScript,
  buildCheckoutStorageSyncScript,
  buildCheckoutUrl,
  buildInboundBridgeScript,
  checkoutOrigin,
  dispatchBridgeMessage,
  parseCheckoutStorageSyncMessage,
  parseWebViewBridgeMessage,
} from './webview-bridge.js';

export interface PactoCheckoutSheetProps {
  visible: boolean;
  /** URL of the hosted checkout page (the one running `bootstrapCheckoutFrame`). */
  checkoutUrl: string;
  publishableKey: string;
  listingId?: string;
  sessionId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  storage?: CheckoutStorageAdapter;
  secureSessionStore?: SecureSessionStoreAdapter;
  linkStateStore?: LinkStateStore;
  /** Certificate pin set for gateway traffic from native escrow hooks. */
  pinning?: PinSet;
  /** Custom fetch for gateway traffic (defaults to pinned fetch when pinning is set). */
  fetch?: FetchLike;
  integrityPolicy?: IntegrityPolicy;
  integrityProbe?: IntegrityProbe;
  userPresence?: UserPresenceOptions;
  userPresenceAdapter?: UserPresenceAdapter;
  /**
   * App deep-link (custom scheme or universal link) the hosted page should
   * navigate to after an external payment step. Pair with `usePactoDeepLink`
   * using the same scheme to resume after the OS routes the app back.
   */
  returnUrl?: string;
  title?: string;
  /**
   * Milliseconds to wait for the hosted checkout page's initial
   * `checkout:ready` handshake before giving up and calling `onError`.
   * Without this, a WebView that never loads or never posts back (a hung
   * frame message) leaves the sheet spinning forever. Default 15000.
   */
  readyTimeoutMs?: number;
  onRequestClose: () => void;
  onReady?: (sessionId: string) => void;
  onStep?: (step: CheckoutStep) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: PactoError | Error) => void;
  onIntegrityWarning?: (signals: string[]) => void;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '600' },
  closeLabel: { fontSize: 15, color: '#0A84FF' },
  webview: { flex: 1 },
});

/**
 * Renders the hosted Pacto checkout inside a WebView, in a modal sheet — the
 * React Native counterpart to `mountFrame()` in `@pacto-connect/elements`.
 * The merchant app only ever supplies a `publishableKey`; no secret key is
 * ever passed to or bundled into the app.
 */
export function PactoCheckoutSheet(props: PactoCheckoutSheetProps) {
  const webViewRef = useRef<WebView<object>>(null);
  const storage = useMemo(
    () => props.storage ?? createDefaultReactNativeCheckoutStorage(),
    [props.storage],
  );
  const secureSessionStore = useMemo(
    () => props.secureSessionStore ?? createDefaultSecureSessionStore(),
    [props.secureSessionStore],
  );
  const linkStateStore = useMemo(
    () => props.linkStateStore ?? createLinkStateStore(),
    [props.linkStateStore],
  );
  const userPresenceAdapter = useMemo(
    () => props.userPresenceAdapter ?? createBiometricsUserPresenceAdapter(),
    [props.userPresenceAdapter],
  );

  const snapshotScope = useMemo(
    () =>
      buildCheckoutSnapshotScope({
        publishableKey: props.publishableKey,
        listingId: props.listingId,
        mode: props.mode ?? 'buy',
      }),
    [props.publishableKey, props.listingId, props.mode],
  );

  const storageKey = useMemo(() => checkoutStorageKey(snapshotScope), [snapshotScope]);
  const [resumedSnapshot, setResumedSnapshot] = useState<CheckoutSnapshot | null>(null);
  const [linkState, setLinkState] = useState<string | null>(null);
  const integrityCheckedRef = useRef(false);
  const readyReceivedRef = useRef(false);
  const onErrorRef = useRef(props.onError);

  useEffect(() => {
    onErrorRef.current = props.onError;
  });

  // Bounds the wait for the hosted page's initial `checkout:ready` handshake
  // — without this, a WebView that never loads or never posts back (a hung
  // frame message) leaves the sheet spinning forever with no way to notice.
  // Reads `onError` via a ref so an unrelated re-render (which commonly
  // recreates an inline `onError` callback) doesn't restart the deadline.
  useEffect(() => {
    if (!props.visible) {
      readyReceivedRef.current = false;
      return;
    }

    const timeoutMs = props.readyTimeoutMs ?? DEFAULT_BRIDGE_MESSAGE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (readyReceivedRef.current) {
        return;
      }
      onErrorRef.current?.(
        new PactoTimeoutError(
          'checkout_ready_timeout',
          'Timed out waiting for the checkout page to become ready',
        ),
      );
    }, timeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [props.visible, props.readyTimeoutMs]);

  useEffect(() => {
    if (!props.visible) {
      setResumedSnapshot(null);
      setLinkState(null);
      integrityCheckedRef.current = false;
      return;
    }

    let cancelled = false;

    void (async () => {
      const state = await linkStateStore.issue(snapshotScope, props.sessionId);
      if (!cancelled) {
        setLinkState(state);
      }
    })();

    void Promise.resolve(storage.getItem(storageKey)).then((raw) => {
      if (cancelled) {
        return;
      }

      if (!raw) {
        setResumedSnapshot(null);
        return;
      }

      const snapshot = parseCheckoutSnapshot(raw);
      if (
        !snapshot ||
        !snapshotMatchesScope(snapshot, snapshotScope) ||
        isCheckoutSnapshotExpired(snapshot, Date.now())
      ) {
        void Promise.resolve(storage.removeItem(storageKey));
        void secureSessionStore.clearSession(snapshotScope);
        setResumedSnapshot(null);
        return;
      }

      setResumedSnapshot(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [
    props.visible,
    storage,
    storageKey,
    snapshotScope,
    linkStateStore,
    props.sessionId,
    secureSessionStore,
  ]);

  useEffect(() => {
    if (!props.visible || integrityCheckedRef.current) {
      return;
    }

    integrityCheckedRef.current = true;
    const probe = props.integrityProbe ?? createJailMonkeyIntegrityProbe();
    const policy = props.integrityPolicy ?? DEFAULT_INTEGRITY_POLICY;

    void evaluateDeviceIntegrity(probe, policy)
      .then((result) => {
        if (result.recommendation === 'warn' && result.signals.length > 0) {
          props.onIntegrityWarning?.(result.signals);
        }
      })
      .catch((error) => {
        if (error instanceof Error) {
          props.onError?.(error);
        }
      });
  }, [
    props.visible,
    props.integrityPolicy,
    props.integrityProbe,
    props.onIntegrityWarning,
    props.onError,
  ]);

  const uri = useMemo(
    () =>
      buildCheckoutUrl({
        checkoutUrl: props.checkoutUrl,
        publishableKey: props.publishableKey,
        listingId: props.listingId,
        sessionId: props.sessionId ?? resumedSnapshot?.sessionId,
        mode: props.mode,
        testMode: props.testMode,
        returnUrl: props.returnUrl,
        linkState: linkState ?? undefined,
      }),
    [
      props.checkoutUrl,
      props.publishableKey,
      props.listingId,
      props.sessionId,
      props.mode,
      props.testMode,
      props.returnUrl,
      linkState,
      resumedSnapshot?.sessionId,
    ],
  );

  const userPresenceEnabled = props.userPresence?.enabled !== false;

  const injectedBeforeLoad = useMemo(() => {
    const scripts = [BRIDGE_SHIM_SCRIPT];
    if (userPresenceEnabled) {
      scripts.unshift(USER_PRESENCE_GATE_SCRIPT);
    }
    if (resumedSnapshot) {
      scripts.unshift(
        buildCheckoutStorageSeedScript(storageKey, serializeCheckoutSnapshot(resumedSnapshot)),
      );
    }
    return scripts.join('');
  }, [resumedSnapshot, storageKey, userPresenceEnabled]);

  const expectedOrigin = useMemo(() => checkoutOrigin(props.checkoutUrl), [props.checkoutUrl]);

  const clearSessionMaterial = useCallback(() => {
    void secureSessionStore.clearSession(snapshotScope);
  }, [secureSessionStore, snapshotScope]);

  const syncHostedStorage = useCallback(() => {
    webViewRef.current?.injectJavaScript(buildCheckoutStorageSyncScript());
  }, []);

  const persistSessionFromSnapshot = useCallback(
    (snapshot: CheckoutSnapshot) => {
      void secureSessionStore.saveSession(snapshotScope, snapshot.session);
    },
    [secureSessionStore, snapshotScope],
  );

  const persistSyncedSnapshot = useCallback(
    (payload: { key: string; value: string }) => {
      if (payload.key !== storageKey) {
        return;
      }

      const snapshot = parseCheckoutSnapshot(payload.value);
      if (!snapshot || !snapshotMatchesScope(snapshot, snapshotScope)) {
        return;
      }

      void Promise.resolve(storage.setItem(storageKey, payload.value));
      persistSessionFromSnapshot(snapshot);
    },
    [storage, storageKey, snapshotScope, persistSessionFromSnapshot],
  );

  const handleUserPresenceRequest = useCallback(
    async (request: NonNullable<ReturnType<typeof parseUserPresenceRequest>>) => {
      const result = await userPresenceAdapter.requestPresence({
        ...props.userPresence,
        enabled: userPresenceEnabled,
      });

      if (result.success) {
        webViewRef.current?.injectJavaScript(
          buildUserPresenceContinuationScript(request.requestId),
        );
        return;
      }

      webViewRef.current?.injectJavaScript(buildUserPresenceAbortScript(request.requestId));

      if (result.cancelled) {
        return;
      }

      if (result.error) {
        props.onError?.(result.error);
      }
    },
    [props.userPresence, props.onError, userPresenceAdapter, userPresenceEnabled],
  );

  const handleClose = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      buildInboundBridgeScript({ type: 'checkout:close', payload: {} }),
    );
    clearSessionMaterial();
    props.onRequestClose();
  }, [clearSessionMaterial, props.onRequestClose]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const presenceRequest = parseUserPresenceRequest(event.nativeEvent.data);
      if (presenceRequest) {
        void handleUserPresenceRequest(presenceRequest);
        return;
      }

      const storageSync = parseCheckoutStorageSyncMessage(
        event.nativeEvent.data,
        event.nativeEvent.url,
        expectedOrigin,
      );
      if (storageSync) {
        persistSyncedSnapshot(storageSync);
        return;
      }

      const message = parseWebViewBridgeMessage(
        event.nativeEvent.data,
        event.nativeEvent.url,
        expectedOrigin,
      );
      if (!message) {
        return;
      }

      dispatchBridgeMessage(message, {
        onReady: (sessionId) => {
          readyReceivedRef.current = true;
          props.onReady?.(sessionId);
          syncHostedStorage();
        },
        onStep: (step) => {
          props.onStep?.(step);
          syncHostedStorage();
        },
        onComplete: (escrow) => {
          void Promise.resolve(storage.removeItem(storageKey));
          clearSessionMaterial();
          props.onComplete?.(escrow);
        },
        onDispute: (escrow) => {
          void Promise.resolve(storage.removeItem(storageKey));
          clearSessionMaterial();
          props.onDispute?.(escrow);
        },
        onError: (error) => {
          clearSessionMaterial();
          props.onError?.(error);
        },
        onClose: () => {
          clearSessionMaterial();
          props.onRequestClose();
        },
      });
    },
    [
      expectedOrigin,
      persistSyncedSnapshot,
      handleUserPresenceRequest,
      props.onReady,
      props.onStep,
      props.onComplete,
      props.onDispute,
      props.onError,
      props.onRequestClose,
      storage,
      storageKey,
      syncHostedStorage,
      clearSessionMaterial,
    ],
  );

  const handleShouldStartLoad = useCallback(
    (request: WebViewNavigation): boolean => {
      let origin: string;
      try {
        origin = new URL(request.url).origin;
      } catch {
        return false;
      }

      if (origin === expectedOrigin) {
        return true;
      }

      if (props.returnUrl && request.url.startsWith(props.returnUrl)) {
        return false;
      }

      Linking.openURL(request.url).catch(() => {});
      return false;
    },
    [expectedOrigin, props.returnUrl],
  );

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{props.title ?? 'Checkout'}</Text>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close checkout"
          >
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>
        <WebView<object>
          ref={webViewRef}
          style={styles.webview}
          source={{ uri }}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
          originWhitelist={[expectedOrigin]}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          allowFileAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          startInLoadingState
        />
      </SafeAreaView>
    </Modal>
  );
}

// Expose gateway fetch for escrow hook consumers wiring the same checkout session.
export function resolveCheckoutGatewayFetch(props: {
  fetch?: FetchLike;
  pinning?: PinSet;
}): FetchLike | undefined {
  if (props.fetch) {
    return props.fetch;
  }
  if (props.pinning) {
    return createPinnedFetch(props.pinning);
  }
  return undefined;
}
