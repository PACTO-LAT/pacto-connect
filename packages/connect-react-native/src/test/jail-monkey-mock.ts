let signals = {
  jailBroken: false,
  canMockLocation: false,
  hookDetected: false,
  isDebuggedMode: false,
  isOnExternalStorage: false,
};

export function isJailBroken(): boolean {
  return signals.jailBroken;
}

export function canMockLocation(): boolean {
  return signals.canMockLocation;
}

export function hookDetected(): boolean {
  return signals.hookDetected;
}

export function isDebuggedMode(): boolean {
  return signals.isDebuggedMode;
}

export function isOnExternalStorage(): boolean {
  return signals.isOnExternalStorage;
}

export function __setSignals(next: Partial<typeof signals>): void {
  signals = { ...signals, ...next };
}

export function __reset(): void {
  signals = {
    jailBroken: false,
    canMockLocation: false,
    hookDetected: false,
    isDebuggedMode: false,
    isOnExternalStorage: false,
  };
}
