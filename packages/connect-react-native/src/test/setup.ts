import '@testing-library/jest-dom/vitest';

if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => 'test-uuid-0000-0000-0000-000000000000';
}
