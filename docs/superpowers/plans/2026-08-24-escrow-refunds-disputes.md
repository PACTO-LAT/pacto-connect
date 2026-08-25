# Escrow Refunds, Cancellations, and Dispute Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cancel, refund, open dispute, and admin resolve dispute to the gateway with Prisma persistence, transition guard, idempotency, webhooks, SDK resources, and terminal widget states for refunded/disputed escrows.

**Architecture:** Pure `transitions.ts` guard; `lifecycle.ts` orchestrates simulator + Prisma + webhooks; new routes mounted under `/v1/escrows`. Simulator remains test-mode store and SSE bus.

**Tech Stack:** TypeScript, Hono, Prisma/PostgreSQL, Vitest, React, web components.

**Spec:** GitHub issue #55

## Global Constraints

- Test mode only for escrow mutations (live → 501).
- Idempotency on every new mutating endpoint.
- Typed `escrow_error` taxonomy (PACTO_ESCROW).
- Do not modify webhook delivery/retry machinery.
- One PR, lifecycle scope only.

---

### Task 1: Prisma schema and migration

**Files:**
- Modify: `services/connect-gateway/prisma/schema.prisma`
- Create: `services/connect-gateway/prisma/migrations/20260824120000_add_escrow_lifecycle/migration.sql`

**Interfaces:**
- Produces: `Escrow`, `EscrowRefund`, `EscrowDispute` models and enums.

- [ ] Add enums and models per plan
- [ ] Hand-write migration SQL
- [ ] Run `npm run db:generate -w @pacto-connect/gateway`

---

### Task 2: Transition guard (TDD)

**Files:**
- Create: `services/connect-gateway/src/escrow/transitions.ts`
- Create: `services/connect-gateway/src/escrow/transitions.test.ts`

- [ ] Write failing tests for every illegal transition
- [ ] Implement `assertTransition`
- [ ] Run: `npm run test -w @pacto-connect/gateway -- transitions.test.ts`

---

### Task 3: Lifecycle service (TDD)

**Files:**
- Create: `services/connect-gateway/src/escrow/lifecycle.ts`
- Create: `services/connect-gateway/src/escrow/lifecycle.test.ts`

- [ ] Write failing unit tests for cancel/refund/dispute/resolve
- [ ] Implement lifecycle with Prisma + simulator
- [ ] Run lifecycle tests

---

### Task 4: Gateway routes (TDD)

**Files:**
- Create: `services/connect-gateway/src/routes/escrow-lifecycle.ts`
- Create: `services/connect-gateway/src/routes/escrow-lifecycle.test.ts`
- Modify: `services/connect-gateway/src/routes/escrows.ts`

- [ ] Route tests: success, 409, 404, 501, idempotent replay
- [ ] Mount routes with idempotency middleware
- [ ] Run escrow-lifecycle route tests

---

### Task 5: Webhooks

**Files:**
- Modify: `services/connect-gateway/src/webhooks/types.ts`, `events.ts`, `WEBHOOKS.md`

- [ ] Add `escrow.cancelled`, `escrow.refunded`, `dispute.resolved`
- [ ] Wire emitters from lifecycle

---

### Task 6: Simulator + test controls

**Files:**
- Modify: `services/connect-gateway/src/testmode/simulator.ts`, `simulator.test.ts`, `routes/test-controls.ts`

- [ ] Refactor simulator to use transition guard
- [ ] Add cancel/refund/dispute/resolve + remainingAmount
- [ ] forceDispute/forceTimeout via lifecycle

---

### Task 7: connect-core

**Files:**
- Modify: `packages/connect-core/src/resources.ts`, `taxonomy.ts`, `escrow-events.ts`, `checkout-flow.ts`, `i18n.ts`, `bridge.ts`, `index.ts` + tests

- [ ] SDK methods and types
- [ ] New SSE event names and milestones
- [ ] Checkout step `refunded`, callbacks, bridge events

---

### Task 8: Widgets

**Files:**
- Modify: `packages/connect-react/src/PactoCheckout.tsx`, `PactoCheckout.test.tsx`
- Modify: `packages/connect-elements/src/ui.ts`, `element.ts`, `frame.ts`, `index.test.ts`
- Modify: `packages/connect-react-native/src/escrow-events.ts` + test

- [ ] Terminal refunded UI + tests
- [ ] RN polling STATUS_MILESTONE map

---

### Task 9: PR

- [ ] Branch `feat/escrow-refunds-disputes`
- [ ] Commits as felipevega2x / feliaguilar5@gmail.com
- [ ] Push fork, open PR with `Closes #55`
