'use client';

import { PactoCheckout } from '@pacto-connect/react';
import { useState } from 'react';

const publishableKey = process.env.NEXT_PUBLIC_PACTO_PUBLISHABLE_KEY ?? 'pk_test_demo';
const gatewayUrl = process.env.NEXT_PUBLIC_PACTO_GATEWAY_URL || undefined;
const listingId = process.env.NEXT_PUBLIC_PACTO_LISTING_ID || undefined;

export default function StorefrontPage() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="store">
      <header className="store-header">
        <h1>Acme Stablecoins</h1>
        <p>Buy USDC with local payment rails — powered by Pacto Connect.</p>
      </header>

      <article className="product-card">
        <h2>100 USDC</h2>
        <p className="product-desc">
          Instant delivery to your Stellar wallet after fiat confirmation.
        </p>
        <div className="product-meta">
          <span className="product-price">₡5,000</span>
          <button type="button" className="btn-buy" onClick={() => setOpen(true)}>
            Buy now
          </button>
        </div>
      </article>

      {error && <p className="error-banner">{error}</p>}

      <PactoCheckout
        publishableKey={publishableKey}
        gatewayUrl={gatewayUrl}
        listingId={listingId}
        mode="buy"
        testMode
        open={open}
        onClose={() => setOpen(false)}
        onComplete={() => setOpen(false)}
        onError={(err) => setError(err.message)}
      />
    </main>
  );
}
