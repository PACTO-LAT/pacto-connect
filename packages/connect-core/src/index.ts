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
  DEFAULT_BRIDGE_MESSAGE_TIMEOUT_MS,
  isBridgeMessageOfType,
  isOriginAllowed,
  isPactoBridgeEnvelope,
  PACTO_BRIDGE_SOURCE,
  PACTO_BRIDGE_VERSION,
  type PactoBridgeEnvelope,
  type PactoBridgeEventType,
  type PactoBridgeMessage,
  type PactoBridgePayloadMap,
  type WaitForBridgeMessageOptions,
  waitForBridgeMessage,
} from './bridge.js';
export {
  CheckoutFlowController,
  type CheckoutFlowOptions,
  type CheckoutFlowResilienceOptions,
  type CheckoutFlowState,
  type CheckoutStep,
  createInitialCheckoutState,
} from './checkout-flow.js';
export {
  applyCheckoutTransition,
  CheckoutQuoteExpiredError,
  canTransition,
  IllegalCheckoutTransitionError,
  isPersistableStep,
  isQuoteExpired,
  isTerminalCheckoutStep,
} from './checkout-machine.js';
export {
  buildCheckoutSnapshotScope,
  CHECKOUT_SNAPSHOT_VERSION,
  type CheckoutSessionEnvelope,
  type CheckoutSnapshot,
  type CheckoutSnapshotScope,
  type CheckoutStorageAdapter,
  checkoutStorageKey,
  createMemoryCheckoutStorage,
  createWebCheckoutStorage,
  isCheckoutSnapshotExpired,
  parseCheckoutSnapshot,
  serializeCheckoutSnapshot,
  snapshotMatchesScope,
  type WebStorageLike,
} from './checkout-storage.js';
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
  isRetryableError,
  PactoApiError,
  PactoAuthError,
  PactoCircuitOpenError,
  PactoError,
  type PactoErrorOptions,
  PactoEscrowError,
  PactoRateLimitError,
  PactoRetryExhaustedError,
  PactoSecurityError,
  PactoSessionError,
  PactoTimeoutError,
} from './errors.js';
export {
  ESCROW_EVENT_NAMES,
  type EscrowEvent,
  type EscrowEventHandler,
  type EscrowEventName,
  type EscrowMilestone,
  type EscrowSubscribeOptions,
  type SessionConnectionConfig,
} from './escrow-events.js';
export type { FetchLike } from './http.js';
export {
  en as enMessages,
  es as esMessages,
  formatMessage,
  type PactoLocale,
  type PactoMessages,
  resolveMessages,
} from './i18n.js';
export { isTestMode, keyMode } from './keys.js';
export {
  assertPaymentRailConformance,
  createDefaultPaymentRailRegistry,
  createPaymentRailRegistry,
  createSinpeRail,
  createSpeiRail,
  type PaymentInstruction,
  type PaymentInstructionInput,
  type PaymentRailAdapter,
  type PaymentRailRegistry,
  RAIL_ADAPTER_CONTRACT_VERSION,
  RailError,
  type RailErrorCode,
  type RailQuoteInput,
  type RailQuoteResult,
  type SettlementConfirmation,
  type SettlementConfirmationInput,
  sinpeRail,
  speiRail,
} from './rails/index.js';
export {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  type CircuitBreakerTransition,
  type CircuitBreakerTransitionReason,
  computeBackoffDelay,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  type ExecuteContext,
  ResiliencePolicy,
  type ResiliencePolicyConfig,
  RetryBudget,
  withTimeout,
} from './resilience/index.js';
export type {
  CancelEscrowParams,
  CreateEscrowParams,
  CreateQuoteParams,
  DepositParams,
  Escrow,
  EscrowDispute,
  EscrowRefund,
  EscrowStatus,
  EscrowStatusResponse,
  FiatPaymentMethod,
  FiatReceiptParams,
  Listing,
  OpenDisputeParams,
  PactoApiClient,
  Quote,
  RefundEscrowParams,
  ResolveDisputeParams,
} from './resources.js';
export {
  classifyGatewayError,
  ESCROW_DETAIL_CODES,
  type EscrowDetailCode,
  generateRequestId,
  isEscrowDetailCode,
  isPactoErrorCode,
  isRetryableErrorCode,
  isSecurityDetailCode,
  PACTO_ERROR_CODES,
  type PactoErrorCode,
  REQUEST_ID_HEADER,
  RETRYABLE_ERROR_CODES,
  SECURITY_DETAIL_CODES,
  type SecurityDetailCode,
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
