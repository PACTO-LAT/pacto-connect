/**
 * @pacto-connect/react-native
 *
 * React Native SDK for Pacto Connect: a WebView-hosted checkout sheet,
 * deep-link return handling, and an escrow event hook — reusing
 * `@pacto-connect/core`'s handshake/session model rather than reimplementing
 * the checkout UI natively.
 */

export {
  type PactoReturnLinkResult,
  parsePactoReturnUrl,
  type UsePactoDeepLinkOptions,
  usePactoDeepLink,
} from './deep-link.js';
export {
  type PactoEscrowTransport,
  resolvePactoEscrowTransport,
  statusToSyntheticEvent,
  type UsePactoEscrowEventsOptions,
  type UsePactoEscrowEventsResult,
  usePactoEscrowEvents,
} from './escrow-events.js';
export { PactoCheckoutSheet, type PactoCheckoutSheetProps } from './PactoCheckoutSheet.js';
export {
  BRIDGE_SHIM_SCRIPT,
  type BuildCheckoutUrlOptions,
  buildCheckoutUrl,
  buildInboundBridgeScript,
  checkoutOrigin,
  dispatchBridgeMessage,
  parseWebViewBridgeMessage,
} from './webview-bridge.js';

export const VERSION = '0.0.0';
