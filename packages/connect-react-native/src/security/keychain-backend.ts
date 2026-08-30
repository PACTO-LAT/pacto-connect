import type { SecureStorageBackend } from './secure-session-store.js';

/**
 * Secure storage backend backed by iOS Keychain / Android Keystore via
 * `react-native-keychain` (optional peer dependency).
 */
export function createKeychainSecureStorageBackend(
  service = 'pacto-connect-session',
): SecureStorageBackend {
  return {
    async getItem(key) {
      const Keychain = await import('react-native-keychain');
      const credentials = await Keychain.getGenericPassword({ service: `${service}:${key}` });
      if (!credentials) {
        return null;
      }
      return credentials.password;
    },
    async setItem(key, value) {
      const Keychain = await import('react-native-keychain');
      await Keychain.setGenericPassword(key, value, {
        service: `${service}:${key}`,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async removeItem(key) {
      const Keychain = await import('react-native-keychain');
      await Keychain.resetGenericPassword({ service: `${service}:${key}` });
    },
  };
}
