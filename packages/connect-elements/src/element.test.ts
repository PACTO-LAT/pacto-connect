import { describe, expect, it } from 'vitest';
import {
  applyCheckoutOptions,
  ELEMENT_TAG,
  type PactoCheckoutElement,
  registerPactoCheckoutElement,
} from './element.js';

function createElement(): PactoCheckoutElement {
  registerPactoCheckoutElement();
  return document.createElement(ELEMENT_TAG) as PactoCheckoutElement;
}

describe('PactoCheckoutElement locale/rail-region attributes', () => {
  it('reads locale and rail-region from attributes', () => {
    const element = createElement();
    element.setAttribute('publishable-key', 'pk_test_1');
    element.setAttribute('locale', 'pt');
    element.setAttribute('rail-region', 'MX');

    const options = element.readOptionsFromAttributes();
    expect(options.locale).toBe('pt');
    expect(options.railRegion).toBe('MX');
  });

  it('leaves locale and rail-region undefined when the attributes are absent', () => {
    const element = createElement();
    element.setAttribute('publishable-key', 'pk_test_1');

    const options = element.readOptionsFromAttributes();
    expect(options.locale).toBeUndefined();
    expect(options.railRegion).toBeUndefined();
  });

  it('reflects railRegion from options onto the rail-region attribute', () => {
    const element = createElement();
    applyCheckoutOptions(element, { publishableKey: 'pk_test_1', railRegion: 'BR' });

    expect(element.getAttribute('rail-region')).toBe('BR');
  });

  it('does not set the rail-region attribute when railRegion is not provided', () => {
    const element = createElement();
    applyCheckoutOptions(element, { publishableKey: 'pk_test_1' });

    expect(element.hasAttribute('rail-region')).toBe(false);
  });

  it('lists rail-region among the observed attributes so live updates re-bootstrap the view', () => {
    const ctor = customElements.get(ELEMENT_TAG) as unknown as { observedAttributes: string[] };
    expect(ctor.observedAttributes).toContain('rail-region');
    expect(ctor.observedAttributes).toContain('locale');
  });
});
