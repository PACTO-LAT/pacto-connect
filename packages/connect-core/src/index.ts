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
  assertCatalogueParity,
  en as enMessages,
  es as esMessages,
  formatAssetAmount,
  formatCurrency,
  formatDate,
  formatGender,
  formatMessage,
  formatPlural,
  type Gender,
  type LocaleResolutionOptions,
  type PactoLocale,
  type PactoMessages,
  type PluralForms,
  pt as ptMessages,
  type RailRegion,
  resolveKeyedMessage,
  resolveLocale,
  resolveMessages,
} from './i18n/index.js';
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
  buildCheckoutStylesheet,
  DEFAULT_THEME,
  type DeepPartial,
  type PactoTheme,
  STYLE_ELEMENT_ID,
  themeToCssVars,
} from './theme.js';

export const VERSION = '0.0.0';
