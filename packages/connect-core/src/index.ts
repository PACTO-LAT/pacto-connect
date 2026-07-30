/**
 * @pacto-connect/core
 *
 * Framework-agnostic SDK core for Pacto Connect.
 */

export {
  type BridgeClient,
  type BridgeClientOptions,
  type BridgeHost,
  type BridgeHostOptions,
  createBridgeClient,
  createBridgeHost,
  isOriginAllowed,
  isPactoBridgeEnvelope,
  PACTO_BRIDGE_SOURCE,
  PACTO_BRIDGE_VERSION,
  type PactoBridgeEnvelope,
  type PactoBridgeEventType,
  type PactoBridgeMessage,
  type PactoBridgePayloadMap,
} from './bridge.js';
export {
  CheckoutFlowController,
  type CheckoutFlowOptions,
  type CheckoutFlowState,
  type CheckoutStep,
} from './checkout-flow.js';
export {
  type CheckoutMode,
  type CreateCheckoutSessionParams,
  DEFAULT_GATEWAY_URL,
  init,
  Pacto,
  type PactoClient,
  type PactoInitOptions,
  PactoSession,
  type PactoSessionData,
} from './client.js';
export {
  PactoApiError,
  PactoAuthError,
  PactoError,
  type PactoErrorOptions,
  PactoEscrowError,
  PactoRateLimitError,
  PactoSessionError,
} from './errors.js';
export {
  ESCROW_EVENT_NAMES,
  type EscrowEvent,
  type EscrowEventHandler,
  type EscrowEventName,
  type EscrowMilestone,
  type EscrowSubscribeOptions,
} from './escrow-events.js';
export {
  en as enMessages,
  es as esMessages,
  formatMessage,
  type PactoLocale,
  type PactoMessages,
  resolveMessages,
} from './i18n.js';
export { isTestMode, keyMode } from './keys.js';
export type {
  CreateEscrowParams,
  CreateQuoteParams,
  DepositParams,
  Escrow,
  EscrowStatus,
  EscrowStatusResponse,
  FiatPaymentMethod,
  FiatReceiptParams,
  Listing,
  PactoApiClient,
  Quote,
} from './resources.js';
export {
  classifyGatewayError,
  generateRequestId,
  isPactoErrorCode,
  PACTO_ERROR_CODES,
  type PactoErrorCode,
  REQUEST_ID_HEADER,
} from './taxonomy.js';
export {
  buildCheckoutStylesheet,
  DEFAULT_THEME,
  type DeepPartial,
  type PactoTheme,
  STYLE_ELEMENT_ID,
  themeToCssVars,
} from './theme.js';

export const VERSION = '0.0.0';
