import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export interface FocusTrapStepFocus {
  /** Element to move focus to whenever `key` changes, e.g. the current step's heading. */
  target: RefObject<HTMLElement | null>;
  /** Value identifying the current step. A change re-applies focus to `target`. */
  key: unknown;
}

/**
 * Traps focus inside `containerRef` while `active`, restoring it to whatever
 * was focused beforehand once deactivated (or unmounted) — the "return to
 * trigger on close" behaviour. `onEscape` wires the Escape key to dismissal.
 *
 * `stepFocus` extends the trap (rather than replacing it) with predictable
 * focus movement on step change: whenever `stepFocus.key` changes while the
 * trap is active, focus moves to `stepFocus.target` (typically the new step's
 * heading), so assistive tech both hears the live-region announcement and
 * lands on content describing the new step.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  stepFocus?: FocusTrapStepFocus,
): void {
  const lastStepKeyRef = useRef<unknown>(undefined);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      hasMountedRef.current = false;
      return;
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastStepKeyRef.current = stepFocus?.key;
      return;
    }

    if (stepFocus && stepFocus.key !== lastStepKeyRef.current) {
      lastStepKeyRef.current = stepFocus.key;
      stepFocus.target.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepFocus?.key]);

  useEffect(() => {
    if (!active || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = getFocusableElements(container);
    const initialFocus = focusable.at(0);
    if (initialFocus) {
      initialFocus.focus();
    } else {
      container.focus();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape?.();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const elements = getFocusableElements(container);
      const first = elements.at(0);
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const activeEl = document.activeElement as HTMLElement;

      if (event.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef, onEscape]);
}
