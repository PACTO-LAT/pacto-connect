/**
 * @pacto-connect/react-native
 *
 * React Native SDK for Pacto Connect: a WebView-hosted checkout sheet,
 * deep-link return handling, and an escrow event hook — reusing
 * `@pacto-connect/core`'s handshake/session model rather than reimplementing
 * the checkout UI natively.
 */

export {
  buildCheckoutSnapshotScope,
  checkoutStorageKey,
  createDefaultReactNativeCheckoutStorage,
  createReactNativeCheckoutStorage,
  type ReactNativeStorageBackend,
} from './checkout-storage.js';
export {
  type PactoReturnLinkResult,
  parsePactoReturnUrl,
  type UsePactoDeepLinkOptions,
  usePactoDeepLink,
  verifyPactoReturnLink,
} from './deep-link.js';
export {
  DEFAULT_SESSION_REFRESH_MARGIN_MS,
  isSessionExpiringSoon,
  type PactoEscrowTransport,
  resolvePactoEscrowTransport,
  statusToSyntheticEvent,
  type UsePactoEscrowEventsOptions,
  type UsePactoEscrowEventsResult,
  usePactoEscrowEvents,
} from './escrow-events.js';
export {
  PactoCheckoutSheet,
  type PactoCheckoutSheetProps,
  resolveCheckoutGatewayFetch,
} from './PactoCheckoutSheet.js';
export {
  createMockPinnedFetch,
  createPinnedFetch,
  type PinSet,
} from './security/cert-pinning.js';
export {
  createJailMonkeyIntegrityProbe,
  createMockIntegrityProbe,
  DEFAULT_INTEGRITY_POLICY,
  evaluateDeviceIntegrity,
  type IntegrityPolicy,
  type IntegrityProbe,
  type IntegrityResult,
  resolveIntegrityPolicy,
} from './security/device-integrity.js';
export { createKeychainSecureStorageBackend } from './security/keychain-backend.js';
export {
  appendLinkState,
  createLinkStateStore,
  DEFAULT_LINK_STATE_TTL_MS,
  type LinkStateStore,
} from './security/link-state.js';
export {
  createDefaultSecureSessionStore,
  createMemorySecureSessionStore,
  createMemorySecureStorageBackend,
  createSecureSessionStore,
  type SecureSessionStoreAdapter,
  type SecureStorageBackend,
} from './security/secure-session-store.js';
export {
  buildUserPresenceAbortScript,
  buildUserPresenceContinuationScript,
  createBiometricsUserPresenceAdapter,
  createMockUserPresenceAdapter,
  parseUserPresenceRequest,
  USER_PRESENCE_GATE_SCRIPT,
  type UserPresenceAdapter,
  type UserPresenceOptions,
} from './security/user-presence.js';
export {
  type AndroidAssetLinks,
  type AndroidAssetLinksOptions,
  type AppleAppSiteAssociation,
  type AppleAppSiteAssociationOptions,
  appendLinkState as appendUniversalLinkState,
  buildAndroidAssetLinks,
  buildAppleAppSiteAssociation,
} from './universal-links.js';
export {
  BRIDGE_SHIM_SCRIPT,
  type BuildCheckoutUrlOptions,
  buildCheckoutStorageSeedScript,
  buildCheckoutStorageSyncScript,
  buildCheckoutUrl,
  buildInboundBridgeScript,
  CHECKOUT_STORAGE_SYNC_SOURCE,
  checkoutOrigin,
  dispatchBridgeMessage,
  parseCheckoutStorageSyncMessage,
  parseWebViewBridgeMessage,
} from './webview-bridge.js';

export const VERSION = '0.0.0';
