// Pure rolling-window arithmetic, independent of the database and of HTTP.
//
// Boundary convention mirrors middleware/rate-limit.ts: a window is the
// half-open interval (now - windowMs, now] — an event exactly windowMs old
// has expired and is excluded, one millisecond younger is included. This
// keeps window semantics identical across the two sliding-window
// implementations in this service.

export interface WindowEvent {
  amount: number;
  occurredAt: Date;
}

export interface VelocityTotals {
  value: number;
  count: number;
}

export function computeWindowStart(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

export function isWithinWindow(occurredAt: Date, now: Date, windowMs: number): boolean {
  return occurredAt.getTime() > computeWindowStart(now, windowMs).getTime();
}

/** Sum value and count for events still inside the window. Used both by the
 * pure boundary tests and as the reference implementation the Prisma-backed
 * aggregation in velocity.ts is expected to match. */
export function aggregateWithinWindow(
  events: readonly WindowEvent[],
  now: Date,
  windowMs: number,
): VelocityTotals {
  const windowStart = computeWindowStart(now, windowMs).getTime();
  let value = 0;
  let count = 0;

  for (const event of events) {
    if (event.occurredAt.getTime() > windowStart) {
      value += event.amount;
      count += 1;
    }
  }

  return { value, count };
}
