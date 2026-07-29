import { PactoCheckout } from '@pacto-connect/react';
import { useState } from 'react';
import { gatewayUrl, products, publishableKey } from './config';

export function App() {
  const [checkoutListingId, setCheckoutListingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="store">
      <header className="store-header">
        <h1>Pacto Marketplace</h1>
        <p>Multiple products, one checkout integration.</p>
      </header>

      <div className="product-grid">
        {products.map((product) => (
          <article key={product.id} className="product-card">
            <h2>{product.name}</h2>
            <p className="product-desc">{product.description}</p>
            <div className="product-meta">
              <span className="product-price">{product.priceLabel}</span>
              <button
                type="button"
                className="btn-buy"
                onClick={() => {
                  setError(null);
                  setCheckoutListingId(product.listingId);
                }}
              >
                Buy now
              </button>
            </div>
          </article>
        ))}
      </div>

      {error && <p className="error-banner">{error}</p>}

      {checkoutListingId && (
        <PactoCheckout
          publishableKey={publishableKey}
          gatewayUrl={gatewayUrl}
          listingId={checkoutListingId}
          mode="buy"
          testMode
          open
          onClose={() => setCheckoutListingId(null)}
          onComplete={() => setCheckoutListingId(null)}
          onError={(err) => setError(err.message)}
        />
      )}
    </main>
  );
}
