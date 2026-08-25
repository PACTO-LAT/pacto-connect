import type {
  CheckoutMode,
  CheckoutStep,
  CheckoutStorageAdapter,
  Escrow,
} from '@pacto-connect/core';
import { type CheckoutSnapshot, serializeCheckoutSnapshot } from '@pacto-connect/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import {
  buildCheckoutSnapshotScope,
  checkoutStorageKey,
  createDefaultReactNativeCheckoutStorage,
  isCheckoutSnapshotExpired,
  parseCheckoutSnapshot,
} from './checkout-storage.js';
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
  /**
   * App deep-link (custom scheme or universal link) the hosted page should
   * navigate to after an external payment step. Pair with `usePactoDeepLink`
   * using the same scheme to resume after the OS routes the app back.
   */
  returnUrl?: string;
  title?: string;
  onRequestClose: () => void;
  onReady?: (sessionId: string) => void;
  onStep?: (step: CheckoutStep) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
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
  // `react-native-webview`'s published root `index.d.ts` types `WebView` as a
  // class generic over its props (`class WebView<P = undefined> extends
  // Component<WebViewProps & P>`); left uninstantiated, `P` defaults to
  // `undefined` and `WebViewProps & undefined` is unusable. Instantiating it
  // explicitly works around the upstream declaration, independent of the ref.
  const webViewRef = useRef<WebView<object>>(null);
  const storage = useMemo(
    () => props.storage ?? createDefaultReactNativeCheckoutStorage(),
    [props.storage],
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

  useEffect(() => {
    if (!props.visible) {
      setResumedSnapshot(null);
      return;
    }

    let cancelled = false;

    void Promise.resolve(storage.getItem(storageKey)).then((raw) => {
      if (cancelled) {
        return;
      }

      if (!raw) {
        setResumedSnapshot(null);
        return;
      }

      const snapshot = parseCheckoutSnapshot(raw);
      if (!snapshot || isCheckoutSnapshotExpired(snapshot, Date.now())) {
        void Promise.resolve(storage.removeItem(storageKey));
        setResumedSnapshot(null);
        return;
      }

      setResumedSnapshot(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [props.visible, storage, storageKey]);

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
      }),
    [
      props.checkoutUrl,
      props.publishableKey,
      props.listingId,
      props.sessionId,
      props.mode,
      props.testMode,
      props.returnUrl,
      resumedSnapshot?.sessionId,
    ],
  );

  const injectedBeforeLoad = useMemo(() => {
    if (!resumedSnapshot) {
      return BRIDGE_SHIM_SCRIPT;
    }

    return `${buildCheckoutStorageSeedScript(storageKey, serializeCheckoutSnapshot(resumedSnapshot))}${BRIDGE_SHIM_SCRIPT}`;
  }, [resumedSnapshot, storageKey]);

  const expectedOrigin = useMemo(() => checkoutOrigin(props.checkoutUrl), [props.checkoutUrl]);

  const syncHostedStorage = useCallback(() => {
    webViewRef.current?.injectJavaScript(buildCheckoutStorageSyncScript());
  }, []);

  const persistSyncedSnapshot = useCallback(
    (payload: { key: string; value: string }) => {
      if (payload.key !== storageKey) {
        return;
      }

      void Promise.resolve(storage.setItem(storageKey, payload.value));
    },
    [storage, storageKey],
  );

  const handleClose = useCallback(() => {
    // Mirrors `mountFrame().close()`: ask the embedded checkout to close
    // rather than just tearing down the WebView, so it can run its own
    // teardown (e.g. releasing the escrow event subscription) first.
    webViewRef.current?.injectJavaScript(
      buildInboundBridgeScript({ type: 'checkout:close', payload: {} }),
    );
    props.onRequestClose();
  }, [props.onRequestClose]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const storageSync = parseCheckoutStorageSyncMessage(event.nativeEvent.data);
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
          props.onReady?.(sessionId);
          syncHostedStorage();
        },
        onStep: (step) => {
          props.onStep?.(step);
          syncHostedStorage();
        },
        onComplete: (escrow) => {
          void Promise.resolve(storage.removeItem(storageKey));
          props.onComplete?.(escrow);
        },
        onDispute: props.onDispute,
        onError: props.onError,
        onClose: props.onRequestClose,
      });
    },
    [
      expectedOrigin,
      persistSyncedSnapshot,
      props.onReady,
      props.onStep,
      props.onComplete,
      props.onDispute,
      props.onError,
      props.onRequestClose,
      storage,
      storageKey,
      syncHostedStorage,
    ],
  );

  const handleShouldStartLoad = useCallback(
    (request: WebViewNavigation): boolean => {
      let origin: string;
      try {
        origin = new URL(request.url).origin;
      } catch {
        return true;
      }

      if (origin === expectedOrigin) {
        return true;
      }

      if (props.returnUrl && request.url.startsWith(props.returnUrl)) {
        // The OS-level deep link (handled by `usePactoDeepLink` in the host
        // app) is the source of truth for the return — don't let the
        // captive WebView also try to navigate to an app-only scheme.
        return false;
      }

      // Anything else (a bank/3-D Secure redirect) leaves the origin-locked
      // checkout WebView and opens in the system browser instead.
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
          startInLoadingState
        />
      </SafeAreaView>
    </Modal>
  );
}
