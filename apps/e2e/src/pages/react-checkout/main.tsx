/**
 * Minimal React harness for E2E tests.
 *
 * Reads gatewayUrl and publishableKey from query params so the same build
 * works for every test run without rebuilding:
 *   http://localhost:5174/?gatewayUrl=http%3A%2F%2Flocalhost%3A8788&publishableKey=pk_test_...
 *
 * Exposes test results on window for Playwright assertions:
 *   window.__lastCompletedEscrow
 *   window.__lastDisputedEscrow
 */

import { PactoCheckout } from '@pacto-connect/react';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { Escrow } from '@pacto-connect/core';

const params = new URLSearchParams(location.search);
const gatewayUrl = params.get('gatewayUrl') ?? undefined;
const publishableKey = params.get('publishableKey') ?? '';

declare global {
  interface Window {
    __lastCompletedEscrow?: Escrow;
    __lastDisputedEscrow?: Escrow;
  }
}

function App() {
  const [open, setOpen] = useState(true);

  return (
    <PactoCheckout
      publishableKey={publishableKey}
      gatewayUrl={gatewayUrl}
      mode="buy"
      testMode={true}
      open={open}
      onClose={() => setOpen(false)}
      onComplete={(escrow) => {
        window.__lastCompletedEscrow = escrow;
      }}
      onDispute={(escrow) => {
        window.__lastDisputedEscrow = escrow;
      }}
    />
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
