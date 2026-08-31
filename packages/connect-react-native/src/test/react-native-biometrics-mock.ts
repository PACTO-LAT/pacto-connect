let available = true;
let enrolled = true;
let nextSuccess = true;
let nextCancelled = false;

export default class ReactNativeBiometrics {
  async isSensorAvailable(): Promise<{
    available: boolean;
    biometryType?: string;
    error?: string;
  }> {
    if (!available) {
      return { available: false, error: 'Biometrics unavailable' };
    }
    if (!enrolled) {
      return { available: false, error: 'Not enrolled' };
    }
    return { available: true, biometryType: 'TouchID' };
  }

  async simplePrompt(): Promise<{ success: boolean; error?: string }> {
    if (nextCancelled) {
      return { success: false, error: 'User cancellation' };
    }
    return { success: nextSuccess };
  }
}

export function __setAvailable(value: boolean): void {
  available = value;
}

export function __setEnrolled(value: boolean): void {
  enrolled = value;
}

export function __setNextSuccess(value: boolean): void {
  nextSuccess = value;
}

export function __setNextCancelled(value: boolean): void {
  nextCancelled = value;
}

export function __reset(): void {
  available = true;
  enrolled = true;
  nextSuccess = true;
  nextCancelled = false;
}
