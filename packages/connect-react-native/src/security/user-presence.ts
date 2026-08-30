import { PactoSecurityError } from '@pacto-connect/core';

export type UserPresenceFallback = 'device-credential' | 'allow';

export interface UserPresenceOptions {
  enabled?: boolean;
  fallback?: UserPresenceFallback;
  promptMessage?: string;
}

export interface UserPresenceResult {
  success: boolean;
  cancelled: boolean;
  error?: PactoSecurityError;
}

export interface UserPresenceAdapter {
  requestPresence(options?: UserPresenceOptions): Promise<UserPresenceResult>;
}

export interface BiometricsModule {
  isSensorAvailable(): Promise<{ available: boolean; biometryType?: string; error?: string }>;
  simplePrompt(options: {
    promptMessage: string;
    fallbackPromptMessage?: string;
  }): Promise<{ success: boolean; error?: string }>;
  createKeys?(): Promise<void>;
  biometricKeysExist?(): Promise<{ keysExist: boolean }>;
}

/** Default adapter via `react-native-biometrics` (optional peer dependency). */
export function createBiometricsUserPresenceAdapter(
  module?: BiometricsModule,
): UserPresenceAdapter {
  return {
    async requestPresence(options) {
      if (options?.enabled === false) {
        return { success: true, cancelled: false };
      }

      let biometrics = module;
      if (!biometrics) {
        const imported = await import('react-native-biometrics');
        const Biometrics = imported.default;
        biometrics = new Biometrics() as unknown as BiometricsModule;
      }

      const availability = await biometrics.isSensorAvailable();
      if (!availability.available) {
        if (options?.fallback === 'allow') {
          return { success: true, cancelled: false };
        }

        const detailCode =
          availability.error === 'Not enrolled'
            ? 'biometric_not_enrolled'
            : 'biometric_unavailable';

        return {
          success: false,
          cancelled: false,
          error: new PactoSecurityError(
            detailCode,
            availability.error ?? 'Biometric authentication is unavailable',
          ),
        };
      }

      const promptMessage = options?.promptMessage ?? 'Confirm payment';
      const result = await biometrics.simplePrompt({
        promptMessage,
        fallbackPromptMessage: 'Enter device passcode',
      });

      if (result.success) {
        return { success: true, cancelled: false };
      }

      if (result.error === 'User cancellation') {
        return {
          success: false,
          cancelled: true,
          error: new PactoSecurityError('biometric_cancelled', 'Biometric confirmation cancelled'),
        };
      }

      return {
        success: false,
        cancelled: false,
        error: new PactoSecurityError(
          'biometric_unavailable',
          result.error ?? 'Biometric authentication failed',
        ),
      };
    },
  };
}

/** Test double for user presence. */
export function createMockUserPresenceAdapter(
  behavior: () => Promise<UserPresenceResult>,
): UserPresenceAdapter {
  return {
    requestPresence() {
      return behavior();
    },
  };
}

export const USER_PRESENCE_SOURCE = 'pacto-connect-rn-presence';

export interface UserPresenceRequestMessage {
  source: typeof USER_PRESENCE_SOURCE;
  requestId: string;
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export function parseUserPresenceRequest(raw: string): UserPresenceRequestMessage | null {
  try {
    const parsed = JSON.parse(raw) as UserPresenceRequestMessage;
    if (parsed.source !== USER_PRESENCE_SOURCE) {
      return null;
    }
    if (typeof parsed.requestId !== 'string' || typeof parsed.url !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildUserPresenceContinuationScript(requestId: string): string {
  return `(function(){if(window.__pactoPresenceResume){window.__pactoPresenceResume(${JSON.stringify(requestId)});}})();true;`;
}

export function buildUserPresenceAbortScript(requestId: string): string {
  return `(function(){if(window.__pactoPresenceAbort){window.__pactoPresenceAbort(${JSON.stringify(requestId)});}})();true;`;
}

/**
 * Injected before page load to gate escrow deposit POST requests behind native
 * biometric confirmation without changing hosted checkout sources.
 */
export const USER_PRESENCE_GATE_SCRIPT = `
(function () {
  if (window.__pactoConnectRNPresenceInstalled) { return true; }
  window.__pactoConnectRNPresenceInstalled = true;
  var pending = {};
  window.__pactoPresenceResume = function (requestId) {
    var entry = pending[requestId];
    if (!entry) { return; }
    delete pending[requestId];
    entry.resolve(window.fetch(entry.url, entry.init));
  };
  window.__pactoPresenceAbort = function (requestId) {
    var entry = pending[requestId];
    if (!entry) { return; }
    delete pending[requestId];
    entry.reject(new DOMException('Biometric confirmation cancelled', 'AbortError'));
  };
  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || 'GET';
    if (method.toUpperCase() === 'POST' && /\\/v1\\/escrows\\/[^/]+\\/deposit/.test(url)) {
      if (!window.ReactNativeWebView) {
        return originalFetch(input, init);
      }
      var requestId = 'presence-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var headers = {};
      if (init && init.headers) {
        if (init.headers.forEach) {
          init.headers.forEach(function (value, key) { headers[key] = value; });
        } else {
          headers = init.headers;
        }
      }
      var body = init && init.body;
      var serializedBody = typeof body === 'string' ? body : undefined;
      return new Promise(function (resolve, reject) {
        pending[requestId] = {
          resolve: resolve,
          reject: reject,
          url: url,
          init: { method: method, headers: headers, body: serializedBody }
        };
        window.ReactNativeWebView.postMessage(JSON.stringify({
          source: ${JSON.stringify(USER_PRESENCE_SOURCE)},
          requestId: requestId,
          url: url,
          init: { method: method, headers: headers, body: serializedBody }
        }));
      });
    }
    return originalFetch(input, init);
  };
})();
true;
`;
