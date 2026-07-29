import { pacto } from '@pacto-connect/elements';

const publishableKey = import.meta.env.VITE_PACTO_PUBLISHABLE_KEY ?? 'pk_test_demo';
const gatewayUrl = import.meta.env.VITE_PACTO_GATEWAY_URL || undefined;
const listingId = import.meta.env.VITE_PACTO_LISTING_ID || undefined;

const buyBtn = document.getElementById('buy-btn');
const errorBanner = document.getElementById('error-banner');
const checkoutRoot = document.getElementById('checkout-root');

/** @type {import('@pacto-connect/elements').MountHandle | null} */
let handle = null;

function showError(message) {
  if (!errorBanner) return;
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  if (!errorBanner) return;
  errorBanner.textContent = '';
  errorBanner.hidden = true;
}

buyBtn?.addEventListener('click', () => {
  if (!checkoutRoot) return;
  clearError();
  handle?.destroy();

  handle = pacto.mount(checkoutRoot, {
    publishableKey,
    gatewayUrl,
    listingId,
    mode: 'buy',
    testMode: true,
    onComplete: () => {
      handle?.destroy();
      handle = null;
    },
    onClose: () => {
      handle?.destroy();
      handle = null;
    },
    onError: (err) => showError(err.message),
  });
});
