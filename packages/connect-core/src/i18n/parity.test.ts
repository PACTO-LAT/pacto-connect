import { describe, expect, it } from 'vitest';
import { en, es, pt } from './catalogues/index.js';
import { assertCatalogueParity, catalogueKeySignature } from './parity.js';

describe('catalogue parity', () => {
  it('does not throw for the real, in-sync catalogues', () => {
    expect(() => assertCatalogueParity()).not.toThrow();
  });

  it('gives es and pt the exact same key set as en', () => {
    const canonical = catalogueKeySignature(en as unknown as Record<string, unknown>);
    expect(catalogueKeySignature(es as unknown as Record<string, unknown>)).toBe(canonical);
    expect(catalogueKeySignature(pt as unknown as Record<string, unknown>)).toBe(canonical);
  });

  it('detects a catalogue with a missing key', () => {
    const canonical = catalogueKeySignature(en as unknown as Record<string, unknown>);
    const { confirmDeposit: _dropped, ...rest } = es.actions;
    const broken = { ...es, actions: rest };
    expect(catalogueKeySignature(broken as unknown as Record<string, unknown>)).not.toBe(canonical);
  });

  it('detects a catalogue with an extra key', () => {
    const canonical = catalogueKeySignature(en as unknown as Record<string, unknown>);
    const broken = { ...pt, actions: { ...pt.actions, extraneous: 'oops' } };
    expect(catalogueKeySignature(broken as unknown as Record<string, unknown>)).not.toBe(canonical);
  });

  it('is insensitive to key order', () => {
    const reordered = {
      milestones: es.milestones,
      steps: es.steps,
      labels: es.labels,
      actions: es.actions,
    };
    expect(catalogueKeySignature(reordered as unknown as Record<string, unknown>)).toBe(
      catalogueKeySignature(es as unknown as Record<string, unknown>),
    );
  });
});
