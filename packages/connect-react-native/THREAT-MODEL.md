# React Native Checkout Threat Model

This document states what `@pacto-connect/react-native` defends against, which assets
are at risk, and how each control in the package maps to a guaranteed property. Every
control in the implementation traces to an entry here; every entry is either implemented
or explicitly deferred with a reason.

The React Native checkout is the least defended surface in the product and runs on the
least trusted device. These controls are intentionally coherent — they share this model
and are not independently meaningful.

## Actors

| Actor | Capability |
|-------|------------|
| **Malicious installed app** | Can register a URL scheme or craft universal links if the OS allows it |
| **Filesystem attacker** | Process with read access to app storage (backup, rooted device, malware) |
| **MITM on compromised device** | Can install a trusted custom CA (rooted device, MDM-managed corporate device) |
| **Rooted / jailbroken operator** | Can hook native APIs, bypass OS protections, attach debuggers |
| **Co-resident malware** | Accessibility overlays, keyloggers, injected scripts in other contexts |

## Assets

| Asset | Why it matters |
|-------|----------------|
| **`clientSecret`** | Bearer credential for gateway API calls during checkout |
| **Session tokens** | `sessionId`, expiry, mode — bind API access to a checkout session |
| **Checkout return routing** | Deep-link params that resume the sheet after external payment steps |
| **Payment authorization** | The user's intent to commit a deposit / payment step |

## Attack paths

### AP-1: Deep link injection

Any installed app matching the merchant's URL scheme can craft a return URL with
`sessionId`, `escrowId`, and `status` query params and drive the sheet into a
post-payment state without the checkout originating the link.

### AP-2: Session material exfiltration

Session credentials stored in ordinary (in-memory or AsyncStorage-style) storage can
be read by any process with filesystem access on a compromised device.

### AP-3: WebView bridge spoofing

Bridge messages accepted without constraining which origins may send them allow a
malicious page (or injected script) to post fake checkout events to native code.

### AP-4: WebView navigation escape

An unconstrained WebView can navigate to attacker-controlled origins, load `file://`
resources, or open secondary windows that bypass origin checks.

### AP-5: Unpinned gateway traffic

Gateway `fetch` calls trust whatever certificate chain the device trusts. On a rooted
or MDM-managed device, an attacker-installed CA enables MITM of session refresh,
escrow polling, and SSE streams.

### AP-6: Compromised device operation

Root, jailbreak, debugger, and hooking-framework signals indicate the device may not
enforce OS security guarantees. Silent hard-blocking would false-positive on MDM and
corporate devices.

## Controls

| ID | Control | Stops | Does **not** stop | Implementation | Test |
|----|---------|-------|-------------------|----------------|------|
| C-1 | **Secure session store** | AP-2: credentials at rest in Keychain / Keystore | Malware with keychain API access on unlocked device | `src/security/secure-session-store.ts`, `keychain-backend.ts` | `threat_storage_exfil_session_in_keychain_adapter` |
| C-2 | **Link state parameter** | AP-1: foreign, replayed, unbound, malformed return links | Attacker who also holds a valid unconsumed state from the same checkout | `src/security/link-state.ts`, `deep-link.ts` | `threat_deep_link_injection_rejects_unbound_state`, `threat_deep_link_injection_rejects_replayed_state` |
| C-3 | **WebView origin containment** | AP-3, AP-4: bridge spoofing, navigation escape, file access | Compromised hosted checkout origin itself | `webview-bridge.ts`, `PactoCheckoutSheet.tsx` | `threat_bridge_spoof_rejects_foreign_origin`, `threat_webview_escape_blocks_non_allowlisted_origin` |
| C-4 | **Certificate pinning** | AP-5: MITM with non-pinned CA | Attacker with app binary access who disables pinning in a repackaged build | `src/security/cert-pinning.ts` | `threat_mitm_pin_mismatch_fails_closed`, `threat_mitm_pin_rotation_accepts_next_pin`, `threat_mitm_all_pins_stale_surfaces_recovery_error` |
| C-5 | **Device integrity policy** | AP-6: silent operation on known-compromised devices (integrator choice) | Zero-day root kits with no detectable signal | `src/security/device-integrity.ts` | `threat_compromised_device_integrity_warn_default`, `threat_compromised_device_integrity_block_policy` |
| C-6 | **User presence gate** | Payment commit without user confirmation on shared / unattended device | Accessibility overlay capturing biometric approval | `src/security/user-presence.ts`, fetch gate script in sheet | `threat_payment_commit_requires_biometric`, `threat_payment_commit_cancellation_returns_to_deposit` |
| C-7 | **Session cleanup** | Stale credentials after terminal checkout states | In-flight session during an interrupted (non-terminal) close | `PactoCheckoutSheet.tsx` | `threat_storage_exfil_clears_on_terminal_state` |
| C-8 | **Typed security errors** | Integrators cannot distinguish pinning vs link vs biometric failures | — | `connect-core` taxonomy, RN error mapping | Covered by all threat tests asserting `PactoSecurityError.detailCode` |

## Judgement calls

### Stale certificate pins

**Decision:** Fail closed with `pin_stale` (`PACTO_SECURITY`).

When every configured pin mismatches the server's current certificate, gateway traffic
is blocked. Silent fallback to unpinned `fetch` would defeat the control.

**Recovery path:**

1. Ship an app update with an updated pin set (preferred).
2. Pin sets support rotation: configure both **current** and **next** SPKI hashes so
   server cert rotation does not require a simultaneous client release.
3. Integrators may set `pinning.enabled: false` explicitly as a temporary measure —
   this is deliberate opt-out, never automatic.

### Device integrity default policy

**Decision:** Default to **`warn`**, not block.

MDM-managed corporate devices, emulators in development, and some Android OEM builds
produce integrity signals that are not evidence of fraud. The integrator chooses
`proceed`, `warn`, or `block` based on their risk tolerance. A silent hard block
would break legitimate merchant apps without giving the integrator a policy knob.

## Deferred scope

| Item | Reason |
|------|--------|
| **Full checkout flow-state persistence** | Owned by the resumable checkout issue. This package provides secure backing for session material; flow position consumes it later. |
| **Gateway-side velocity / deny lists** | Server-side controls — separate issue. |
| **Hosted checkout web surface changes** | Out of scope. User-presence gate uses injected fetch interception instead. |
| **JS bundle obfuscation / anti-tamper** | Out of scope. |
| **KYC / buyer identity verification** | Out of scope. |

## Remaining attack surface (after this work)

- **Accessibility / overlay malware** on the device capturing taps or biometrics outside
  the WebView sandbox.
- **Compromised hosted checkout origin** serving malicious JavaScript (web surface is
  out of scope; origin containment assumes the hosted page is trustworthy).
- **Repackaged app** with pinning disabled or integrity policy forced to `proceed`.
- **Server-side fraud** not covered by client controls (velocity limits, deny lists).
- **Flow resumption across app kills** until the resumable checkout issue lands.
