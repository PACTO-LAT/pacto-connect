import { describe, expect, it } from 'vitest';
import { aggregateWithinWindow, computeWindowStart, isWithinWindow } from './window.js';

describe('computeWindowStart', () => {
  it('subtracts windowMs from now', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    expect(computeWindowStart(now, 60_000).toISOString()).toBe('2026-01-01T11:59:00.000Z');
  });
});

describe('isWithinWindow', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const windowMs = 60_000;

  it('excludes a transaction exactly windowMs old (boundary, expired)', () => {
    const boundary = new Date(now.getTime() - windowMs);
    expect(isWithinWindow(boundary, now, windowMs)).toBe(false);
  });

  it('includes a transaction one millisecond inside the window', () => {
    const justInside = new Date(now.getTime() - windowMs + 1);
    expect(isWithinWindow(justInside, now, windowMs)).toBe(true);
  });

  it('includes a transaction at now', () => {
    expect(isWithinWindow(now, now, windowMs)).toBe(true);
  });

  it('excludes a transaction older than the window', () => {
    const tooOld = new Date(now.getTime() - windowMs - 1);
    expect(isWithinWindow(tooOld, now, windowMs)).toBe(false);
  });
});

describe('aggregateWithinWindow', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const windowMs = 60_000;

  it('sums value and count for events inside the window', () => {
    const events = [
      { amount: 10, occurredAt: new Date(now.getTime() - 30_000) },
      { amount: 20, occurredAt: new Date(now.getTime() - 1_000) },
    ];
    expect(aggregateWithinWindow(events, now, windowMs)).toEqual({ value: 30, count: 2 });
  });

  it('excludes an event that has expired out of the window at the boundary', () => {
    const events = [
      { amount: 10, occurredAt: new Date(now.getTime() - windowMs) }, // expired: excluded
      { amount: 20, occurredAt: new Date(now.getTime() - windowMs + 1) }, // still inside
    ];
    expect(aggregateWithinWindow(events, now, windowMs)).toEqual({ value: 20, count: 1 });
  });

  it('frees capacity as an event slides out of the window over time', () => {
    const events = [{ amount: 100, occurredAt: new Date('2026-01-01T11:59:30.000Z') }];

    // 30s old: still inside a 60s window.
    expect(aggregateWithinWindow(events, now, windowMs)).toEqual({ value: 100, count: 1 });

    // Advance the clock 31s: the same event is now 61s old, outside the window.
    const later = new Date(now.getTime() + 31_000);
    expect(aggregateWithinWindow(events, later, windowMs)).toEqual({ value: 0, count: 0 });
  });

  it('returns zero totals for no events', () => {
    expect(aggregateWithinWindow([], now, windowMs)).toEqual({ value: 0, count: 0 });
  });
});
