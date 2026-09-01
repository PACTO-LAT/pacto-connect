# Connect Gateway Risk Controls

A merchant's publishable key is meant to sit in client-side code. If it leaks, request-rate
limiting (`src/middleware/rate-limit.ts`) stops a flood of *requests* but does nothing to cap the
*value* moved at a legitimate request rate. Risk controls close that gap: every escrow creation is
evaluated against the owning merchant's cumulative transacted value, transaction count, and
counterparty allow/deny lists before the escrow is created.

This is velocity and list-based control only. It is explicitly **not** ML-based scoring, KYC, or a
review-queue UI — it exposes the data (decisions), it does not build a console for it.

## Decision points

Every evaluation on the escrow-creation path returns one of three outcomes:

| Outcome | Effect |
| --- | --- |
| `allow` | Escrow creation proceeds. |
| `review` | Escrow creation **still proceeds**, but the decision is recorded and logged at `warn` so it surfaces in structured logs/alerting. Not silently allowed — it is a retrievable record (`GET /admin/merchants/:id/risk/decisions?outcome=review`). |
| `block` | Escrow creation is rejected with a typed `RiskError` (`src/errors.ts`), surfaced to the caller as `409` with `error.type: "risk_error"` and `error.pactoCode: "PACTO_RISK"`. |

## Evaluation order (precedence)

For a session with a `counterpartyRef`, in order:

1. **Deny list.** If the counterparty is on the merchant's deny list, the decision is `block`
   (`reason: "deny_list"`) — **regardless of allow-list membership or velocity**. Deny always wins
   over allow when a counterparty is somehow on both lists; the guard checks deny first and returns
   immediately.
2. **Allow list.** If the counterparty is on the merchant's allow list (and not denied), the
   decision is `allow` (`reason: "allow_list"`) and **velocity checks are bypassed** for this
   evaluation. The transaction still counts toward the merchant's future velocity totals (it is
   real value moving), it just isn't itself checked against the threshold.
3. **Velocity.** Otherwise, the prospective cumulative value and transaction count for the
   merchant over its rolling window are computed and compared against its effective thresholds (see
   below). Value is checked before count when both would breach, purely for a deterministic
   `reason` code — either alone is sufficient to change the outcome.

A session with no `counterpartyRef` skips steps 1–2 and goes straight to velocity. A session with
no `merchantId` (platform-level) skips risk evaluation entirely — velocity controls are
inherently per-merchant.

## Rolling window

Windows are the half-open interval `(now - windowMs, now]`, matching the boundary convention
already used by the IP/key rate limiter: a transaction exactly `windowMs` old has **expired** and
is excluded (`src/risk/window.ts`, `computeWindowStart` / `isWithinWindow` / `aggregateWithinWindow`).
One millisecond younger, it is still counted. This means capacity frees up continuously as old
transactions age out, rather than in discrete buckets.

Only `allow` and `review` decisions contribute to a merchant's velocity totals (`src/risk/velocity.ts`).
`block` decisions do not — no escrow was created, so no value moved.

## Thresholds: two tiers, four values

Each merchant has independently configurable **block** thresholds (`valueThreshold`,
`countThreshold`) and **review** thresholds (`reviewValueThreshold`, `reviewCountThreshold`), plus
a `windowMs`. Every field is nullable — a `null` field means "use the platform default" for that
field specifically. **Resolution order is merchant first, then platform default, per field**
(`src/risk/config.ts#resolveRiskThresholds`):

```
effective.field = merchantSettings.field ?? platformDefault.field
```

Overriding `valueThreshold` for a merchant does not require also overriding `windowMs` or
`reviewCountThreshold` — each is resolved independently.

### Platform defaults and why they're the starting point

| Setting | Default | Why |
| --- | --- | --- |
| `RISK_WINDOW_MS` | `86400000` (24h) | A daily window matches how merchants reason about volume ("today's business") and bounds a leaked-key blast radius to a single day rather than an unbounded lifetime total. |
| `RISK_VALUE_THRESHOLD` | `50000` | Sized to absorb a legitimate peak day for a small-to-mid P2P remittance merchant without nuisance blocking, while still capping worst-case exposure from a leaked key to a bounded, known dollar amount instead of "their full transaction volume" (the exact failure mode this feature exists to prevent). |
| `RISK_COUNT_THRESHOLD` | `200` | A request-rate-limited attacker (60 req/min default, see `rate-limit.ts`) could otherwise place thousands of small transactions per day; 200/day is generous for real usage but caps split-transaction abuse. |
| `RISK_REVIEW_RATIO` | `0.8` | Review fires at 80% of the block threshold, giving a merchant (or platform operator) a `review` decision to react to — raise the threshold, allow-list a known counterparty — before the *next* transaction would have been hard-blocked. |

All four are env-configurable platform-wide, and every field is also overridable per merchant via
the admin API below.

## Admin API

All routes require the admin bearer token (`Authorization: Bearer $GATEWAY_ADMIN_TOKEN`), same as
`/admin/keys`.

### `GET /admin/merchants/:id/risk/settings`

Returns the merchant's raw threshold overrides (`null` fields mean "platform default applies").

### `PUT /admin/merchants/:id/risk/settings`

Body: any subset of `windowMs`, `valueThreshold`, `countThreshold`, `reviewValueThreshold`,
`reviewCountThreshold` (numbers, or `null` to clear an override back to the platform default).
Unset fields are left unchanged.

### `GET /admin/merchants/:id/risk/lists?type=allow|deny`

List a merchant's counterparty list entries, optionally filtered by `type`.

### `POST /admin/merchants/:id/risk/lists`

Body: `{ "listType": "allow" | "deny", "counterpartyRef": "...", "note": "..." }`. `404` if the
merchant does not exist; `409` if the counterparty is already on that list for that merchant.

### `DELETE /admin/merchants/:id/risk/lists/:entryId`

Removes one entry. `404` if the entry does not exist (or belongs to a different merchant).

### `GET /admin/merchants/:id/risk/decisions?outcome=allow|review|block&limit=50`

Retrieves recorded decisions, most recent first (`limit` capped at 200). This is how `review`
decisions — and any decision — are retrieved for follow-up; there is no queue UI, this endpoint is
the data surface for building one.

## Scoping a checkout session

`counterpartyRef` is an optional field on `POST /v1/session`, alongside the existing `merchantId`:

```json
{ "mode": "buy", "listingId": "lst_…", "merchantId": "mrc_…", "counterpartyRef": "wallet_abc123" }
```

It is echoed back on the session response and carried through to the escrow-creation guard. A
session with no `counterpartyRef` still goes through velocity checks; it just cannot match an
allow/deny list entry.

## Logging

Every recorded decision (`allow`, `review`, `block`) is logged through the existing structured
logger (`src/logger.ts`) with the request id, merchant id, session id, counterparty, amount/asset,
outcome, and reason — `review` at `warn`, `block` at `error`, `allow` at `info`. The escrow-creation
span (`escrow.create`, `src/tracing.ts`) also carries `pacto.risk_outcome` / `pacto.risk_reason`
attributes for trace-level correlation.

## Data model

| Model | Purpose |
| --- | --- |
| `MerchantRiskSettings` | Per-merchant threshold overrides (nullable fields; `null` = platform default). |
| `MerchantRiskListEntry` | One row per (merchant, listType, counterpartyRef); unique per merchant+list+counterparty. |
| `RiskDecision` | One row per evaluation performed on the escrow-creation path — the audit trail `review` decisions are retrieved from, and the source of truth for velocity aggregation. |

`counterpartyRef` is a nullable column on `CheckoutSession`. All additions are additive and
nullable/optional — existing single-merchant and platform-level integrations are unaffected, and
the existing IP/key rate limiter (`middleware/rate-limit.ts`) is unchanged.
