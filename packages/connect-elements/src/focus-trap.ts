/**
 * Framework-agnostic focus trap for the checkout dialog.
 *
 * Mirrors the behaviour of the React `useFocusTrap` hook so the custom element
 * has accessibility parity with `<PactoCheckout />`: focus moves into the
 * dialog on activation, Tab cycles within it, Escape requests a close, and the
 * previously focused element is restored on deactivation.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export interface FocusTrap {
  /** Move focus into the container, e.g. after a re-render replaced its children. */
  refocus(): void;
  /** Remove listeners and restore focus to the previously focused element. */
  release(): void;
}

/**
 * Activates a focus trap on `container`. The container is re-queried on every
 * keydown so the trap keeps working across re-renders that swap its children.
 */
export function createFocusTrap(container: HTMLElement, onEscape?: () => void): FocusTrap {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusFirst(): void {
    const focusable = getFocusableElements(container);
    const initial = focusable.at(0);
    if (initial) {
      initial.focus();
    } else {
      container.focus();
    }
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
  focusFirst();

  return {
    refocus(): void {
      if (!container.contains(document.activeElement)) {
        focusFirst();
      }
    },
    release(): void {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    },
  };
}
