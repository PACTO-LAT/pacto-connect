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
export { PactoCheckoutSheet, type PactoCheckoutSheetProps } from './PactoCheckoutSheet.js';
export {
  type AndroidAssetLinks,
  type AndroidAssetLinksOptions,
  type AppleAppSiteAssociation,
  type AppleAppSiteAssociationOptions,
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
