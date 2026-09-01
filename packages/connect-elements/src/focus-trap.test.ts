import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFocusTrap } from './focus-trap';

describe('createFocusTrap', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="dialog" tabindex="-1">
        <button id="first">first</button>
        <input id="middle" />
        <button id="last">last</button>
      </div>
    `;
    container = document.getElementById('dialog') as HTMLElement;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function byId(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it('moves focus to the first focusable element on activation', () => {
    const trap = createFocusTrap(container);
    expect(document.activeElement).toBe(byId('first'));
    trap.release();
  });

  it('invokes onEscape when Escape is pressed', () => {
    const onEscape = vi.fn();
    const trap = createFocusTrap(container, onEscape);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onEscape).toHaveBeenCalledTimes(1);
    trap.release();
  });

  it('wraps focus from last to first on Tab', () => {
    const trap = createFocusTrap(container);
    byId('last').focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));

    expect(document.activeElement).toBe(byId('first'));
    trap.release();
  });

  it('wraps focus from first to last on Shift+Tab', () => {
    const trap = createFocusTrap(container);
    byId('first').focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));

    expect(document.activeElement).toBe(byId('last'));
    trap.release();
  });

  it('restores focus to the previously focused element on release', () => {
    byId('outside').focus();
    const trap = createFocusTrap(container);
    expect(document.activeElement).toBe(byId('first'));

    trap.release();

    expect(document.activeElement).toBe(byId('outside'));
  });

  it('stops trapping focus after release', () => {
    const onEscape = vi.fn();
    const trap = createFocusTrap(container, onEscape);
    trap.release();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onEscape).not.toHaveBeenCalled();
  });

  describe('refocus(target)', () => {
    it('moves focus to the given target regardless of where focus currently sits', () => {
      const trap = createFocusTrap(container);
      byId('middle').focus();

      trap.refocus(byId('first'));

      expect(document.activeElement).toBe(byId('first'));
      trap.release();
    });

    it('moves focus to the target even when focus is already inside the container', () => {
      const trap = createFocusTrap(container);
      byId('last').focus();

      // Without a target, refocus() would be a no-op here since focus never
      // left the container — but a step change should still move focus
      // predictably to the new heading/target.
      trap.refocus(byId('middle'));

      expect(document.activeElement).toBe(byId('middle'));
      trap.release();
    });

    it('falls back to focusing the first focusable element when no target is given and focus left the container', () => {
      const trap = createFocusTrap(container);
      byId('outside').focus();

      trap.refocus();

      expect(document.activeElement).toBe(byId('first'));
      trap.release();
    });

    it('does nothing when no target is given and focus is still inside the container', () => {
      const trap = createFocusTrap(container);
      byId('last').focus();

      trap.refocus();

      expect(document.activeElement).toBe(byId('last'));
      trap.release();
    });
  });
});
