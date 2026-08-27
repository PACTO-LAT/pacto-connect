declare module 'react-native-ssl-pinning' {
  export function fetch(
    url: string,
    options?: RequestInit & { sslPinning?: { certs: string[] } },
  ): Promise<Response>;
}

declare module 'jail-monkey' {
  export function isJailBroken(): boolean;
  export function canMockLocation(): boolean;
  export function hookDetected(): boolean;
  export function isDebuggedMode(): boolean;
  export function isOnExternalStorage(): boolean;
}

declare module 'react-native-keychain' {
  export const ACCESSIBLE: Record<string, string>;
  export function getGenericPassword(options: {
    service: string;
  }): Promise<false | { username: string; password: string }>;
  export function setGenericPassword(
    username: string,
    password: string,
    options: { service: string; accessible?: string },
  ): Promise<void>;
  export function resetGenericPassword(options: { service: string }): Promise<boolean>;
}

declare module 'react-native-biometrics' {
  export default class ReactNativeBiometrics {
    isSensorAvailable(): Promise<{ available: boolean; biometryType?: string; error?: string }>;
    simplePrompt(options?: {
      promptMessage?: string;
    }): Promise<{ success: boolean; error?: string }>;
  }
}
