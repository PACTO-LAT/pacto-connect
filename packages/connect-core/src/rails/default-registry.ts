import { createPaymentRailRegistry } from './registry.js';
import { createSinpeRail } from './sinpe.js';
import { createSpeiRail } from './spei.js';
import type { PaymentRailRegistry } from './types.js';

/**
 * Registry with the built-in SINPE and SPEI rails pre-registered.
 */
export function createDefaultPaymentRailRegistry(): PaymentRailRegistry {
  const registry = createPaymentRailRegistry();
  registry.register(createSinpeRail());
  registry.register(createSpeiRail());
  return registry;
}
