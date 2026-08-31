export async function fetch(
  url: string,
  options?: RequestInit & { sslPinning?: { certs: string[] } },
): Promise<Response> {
  const certs = options?.sslPinning?.certs ?? [];
  const serverPin = (globalThis as { __pactoMockServerPin?: string }).__pactoMockServerPin;

  if (!serverPin || !certs.includes(serverPin)) {
    if (!serverPin) {
      throw new Error('pin set stale — no matching certificate');
    }
    throw new Error('ssl pinning certificate mismatch');
  }

  return globalThis.fetch(url, options);
}

export function __setServerPin(pin: string | null): void {
  (globalThis as { __pactoMockServerPin?: string | null }).__pactoMockServerPin = pin;
}

export function __reset(): void {
  (globalThis as { __pactoMockServerPin?: string | null }).__pactoMockServerPin = undefined;
}
