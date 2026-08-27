import { PactoSecurityError } from '@pacto-connect/core';

export type IntegrityPolicy = 'proceed' | 'warn' | 'block';

export const DEFAULT_INTEGRITY_POLICY: IntegrityPolicy = 'warn';

export interface IntegritySignals {
  jailBroken: boolean;
  canMockLocation: boolean;
  hookDetected: boolean;
  isDebuggedMode: boolean;
  isOnExternalStorage: boolean;
}

export interface IntegrityProbe {
  collectSignals(): Promise<IntegritySignals>;
}

export interface IntegrityResult {
  signals: string[];
  recommendation: IntegrityPolicy;
}

function signalsToList(signals: IntegritySignals): string[] {
  const list: string[] = [];
  if (signals.jailBroken) list.push('jailbroken');
  if (signals.canMockLocation) list.push('mock_location');
  if (signals.hookDetected) list.push('hook_detected');
  if (signals.isDebuggedMode) list.push('debugger_attached');
  if (signals.isOnExternalStorage) list.push('external_storage');
  return list;
}

export function resolveIntegrityPolicy(
  detectedSignals: string[],
  configured: IntegrityPolicy = DEFAULT_INTEGRITY_POLICY,
): IntegrityResult {
  if (detectedSignals.length === 0 || configured === 'proceed') {
    return { signals: detectedSignals, recommendation: 'proceed' };
  }

  if (configured === 'block') {
    return { signals: detectedSignals, recommendation: 'block' };
  }

  return { signals: detectedSignals, recommendation: 'warn' };
}

export async function evaluateDeviceIntegrity(
  probe: IntegrityProbe,
  configured: IntegrityPolicy = DEFAULT_INTEGRITY_POLICY,
): Promise<IntegrityResult> {
  const raw = await probe.collectSignals();
  const signals = signalsToList(raw);
  const result = resolveIntegrityPolicy(signals, configured);

  if (result.recommendation === 'block') {
    throw new PactoSecurityError(
      'device_integrity_blocked',
      `Device integrity policy blocked checkout (${signals.join(', ')})`,
    );
  }

  return result;
}

/** Default probe backed by `jail-monkey` (optional peer dependency). */
export function createJailMonkeyIntegrityProbe(): IntegrityProbe {
  return {
    async collectSignals() {
      const JailMonkey = await import('jail-monkey');
      return {
        jailBroken: JailMonkey.isJailBroken(),
        canMockLocation: JailMonkey.canMockLocation(),
        hookDetected: JailMonkey.hookDetected(),
        isDebuggedMode: JailMonkey.isDebuggedMode(),
        isOnExternalStorage: JailMonkey.isOnExternalStorage(),
      };
    },
  };
}

/** In-memory probe for tests. */
export function createMockIntegrityProbe(signals: Partial<IntegritySignals>): IntegrityProbe {
  return {
    async collectSignals() {
      return {
        jailBroken: signals.jailBroken ?? false,
        canMockLocation: signals.canMockLocation ?? false,
        hookDetected: signals.hookDetected ?? false,
        isDebuggedMode: signals.isDebuggedMode ?? false,
        isOnExternalStorage: signals.isOnExternalStorage ?? false,
      };
    },
  };
}
