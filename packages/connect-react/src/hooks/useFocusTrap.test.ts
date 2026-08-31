import { act, render } from '@testing-library/react';
import { createElement, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './useFocusTrap.js';

function Harness(props: {
  active: boolean;
  step: string;
  onEscape?: () => void;
  useStepFocus?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useFocusTrap(
    containerRef,
    props.active,
    props.onEscape,
    props.useStepFocus ? { target: headingRef, key: props.step } : undefined,
  );

  return createElement(
    'div',
    { ref: containerRef, tabIndex: -1, 'data-testid': 'container' },
    createElement('h2', { ref: headingRef, tabIndex: -1, 'data-testid': 'heading' }, props.step),
    createElement('button', { type: 'button', 'data-testid': 'first' }, 'first'),
    createElement('button', { type: 'button', 'data-testid': 'last' }, 'last'),
  );
}

describe('useFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first focusable element on activation (unchanged base behaviour)', () => {
    const { getByTestId } = render(createElement(Harness, { active: true, step: 'a' }));
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('does not move focus to the step-focus target on the initial activation', () => {
    const { getByTestId } = render(
      createElement(Harness, { active: true, step: 'a', useStepFocus: true }),
    );
    // Base "focus first focusable" behaviour still wins on initial activation.
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('moves focus to the step-focus target when the step key changes while active', () => {
    function Wrapper() {
      const [step, setStep] = useState('a');
      const containerRef = useRef<HTMLDivElement>(null);
      const headingRef = useRef<HTMLHeadingElement>(null);
      useFocusTrap(containerRef, true, undefined, { target: headingRef, key: step });

      return createElement(
        'div',
        null,
        createElement(
          'div',
          { ref: containerRef, tabIndex: -1 },
          createElement('h2', { ref: headingRef, tabIndex: -1, 'data-testid': 'heading' }, step),
          createElement('button', { type: 'button', 'data-testid': 'first' }, 'first'),
        ),
        createElement(
          'button',
          { type: 'button', onClick: () => setStep('b'), 'data-testid': 'advance' },
          'advance',
        ),
      );
    }

    const { getByTestId } = render(createElement(Wrapper));
    expect(document.activeElement).toBe(getByTestId('first'));

    act(() => {
      getByTestId('advance').click();
    });

    expect(document.activeElement).toBe(getByTestId('heading'));
  });

  it('does not move focus when the step key is unchanged', () => {
    function Wrapper() {
      const [, forceRender] = useState(0);
      const containerRef = useRef<HTMLDivElement>(null);
      const headingRef = useRef<HTMLHeadingElement>(null);
      useFocusTrap(containerRef, true, undefined, { target: headingRef, key: 'same' });

      return createElement(
        'div',
        null,
        createElement(
          'div',
          { ref: containerRef, tabIndex: -1 },
          createElement('h2', { ref: headingRef, tabIndex: -1 }, 'heading'),
          createElement('button', { type: 'button', 'data-testid': 'first' }, 'first'),
        ),
        createElement(
          'button',
          { type: 'button', onClick: () => forceRender((n) => n + 1), 'data-testid': 'rerender' },
          'rerender',
        ),
      );
    }

    const { getByTestId } = render(createElement(Wrapper));
    getByTestId('first').focus();
    expect(document.activeElement).toBe(getByTestId('first'));

    act(() => {
      getByTestId('rerender').click();
    });

    // A re-render with the same step key must not steal focus back to the heading.
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('invokes onEscape when Escape is pressed while active', () => {
    const onEscape = vi.fn();
    render(createElement(Harness, { active: true, step: 'a', onEscape }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element on deactivation', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    const { rerender, getByTestId } = render(createElement(Harness, { active: true, step: 'a' }));
    expect(document.activeElement).toBe(getByTestId('first'));

    rerender(createElement(Harness, { active: false, step: 'a' }));

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
