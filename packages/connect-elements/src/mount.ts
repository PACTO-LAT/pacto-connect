import {
  applyCheckoutOptions,
  ELEMENT_TAG,
  type PactoCheckoutElement,
  type PactoCheckoutOptions,
  registerPactoCheckoutElement,
} from './element.js';

export interface MountHandle {
  open(): void;
  close(): void;
  destroy(): void;
  element: PactoCheckoutElement;
}

export function resolveTarget(selector: string | HTMLElement): HTMLElement {
  if (typeof selector !== 'string') {
    return selector;
  }

  const target = document.querySelector(selector);
  if (!target) {
    throw new Error(`[pacto-connect] mount target not found: ${selector}`);
  }

  if (!(target instanceof HTMLElement)) {
    throw new Error(`[pacto-connect] mount target must be an HTMLElement: ${selector}`);
  }

  return target;
}

export function mount(selector: string | HTMLElement, options: PactoCheckoutOptions): MountHandle {
  registerPactoCheckoutElement();

  const target = resolveTarget(selector);
  const element = document.createElement(ELEMENT_TAG) as PactoCheckoutElement;
  applyCheckoutOptions(element, options);
  target.append(element);
  element.open();

  return {
    element,
    open: () => element.open(),
    close: () => element.close(),
    destroy: () => {
      element.close();
      element.remove();
    },
  };
}
