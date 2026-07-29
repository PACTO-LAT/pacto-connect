import type { Escrow } from '@pacto-connect/core';
import {
  PactoCheckoutSheet,
  usePactoDeepLink,
  usePactoEscrowEvents,
} from '@pacto-connect/react-native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';

// The merchant app only ever needs a publishableKey (pk_test_*/pk_live_*) —
// never a secret key. This one is the Connect Gateway's shared test key.
const PUBLISHABLE_KEY = 'pk_test_example';
const CHECKOUT_URL = 'https://connect.pacto.example/checkout';
// Matches `app.json`'s `expo.scheme`. Used both as the checkout's `returnUrl`
// and as the scheme `usePactoDeepLink` listens for. A custom scheme needs no
// server-side setup. `app.json` also declares `associatedDomains` /
// `intentFilters` for `https://checkout.pacto.example/pacto-return` as a
// universal-link alternative — swap this constant for that URL once
// `apple-app-site-association` / `assetlinks.json` are hosted on that domain
// (see `@pacto-connect/react-native`'s `buildAppleAppSiteAssociation` /
// `buildAndroidAssetLinks`, and the Security guide's Universal links section).
const RETURN_URL = 'pacto-example://checkout-return';

export default function App() {
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [lastEscrow, setLastEscrow] = useState<Escrow | null>(null);
  const [lastStep, setLastStep] = useState<string | null>(null);
  const [returnEvent, setReturnEvent] = useState<string | null>(null);

  // Covers the case where a fiat rail needs to redirect out to a bank app or
  // browser mid-checkout, and the OS relaunches this app via the return link
  // instead of routing back through the still-open WebView.
  usePactoDeepLink({
    scheme: RETURN_URL,
    onReturn: (result) => {
      setReturnEvent(JSON.stringify(result));
      setCheckoutVisible(true);
    },
  });

  // Optional, separate integration path: if your own backend created the
  // checkout session (so you already hold `sessionId` + a session
  // `clientSecret` — never the merchant's sk_ key) you can track escrow
  // milestones natively without keeping the WebView open. Disabled here
  // since this demo creates its session inside the WebView instead.
  const escrowTracking = usePactoEscrowEvents({
    publishableKey: PUBLISHABLE_KEY,
    sessionId: 'sess_example',
    clientSecret: 'session_client_secret_example',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    mode: 'buy',
    escrowId: 'escrow_example',
    enabled: false,
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Pacto Connect — React Native example</Text>

      <Button title="Buy USDC" onPress={() => setCheckoutVisible(true)} />

      {lastStep && <Text style={styles.status}>Step: {lastStep}</Text>}
      {lastEscrow && <Text style={styles.status}>Escrow: {lastEscrow.id} ({lastEscrow.status})</Text>}
      {returnEvent && <Text style={styles.status}>Deep-link return: {returnEvent}</Text>}
      <Text style={styles.status}>Escrow hook transport: {escrowTracking.transport ?? 'idle'}</Text>

      <PactoCheckoutSheet
        visible={checkoutVisible}
        checkoutUrl={CHECKOUT_URL}
        publishableKey={PUBLISHABLE_KEY}
        mode="buy"
        testMode
        returnUrl={RETURN_URL}
        onRequestClose={() => setCheckoutVisible(false)}
        onStep={(step) => setLastStep(step)}
        onComplete={(escrow) => {
          setLastEscrow(escrow);
          setCheckoutVisible(false);
        }}
        onDispute={(escrow) => setLastEscrow(escrow)}
        onError={(error) => console.warn('[pacto-connect]', error.message)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  status: { fontSize: 13, color: '#555' },
});
