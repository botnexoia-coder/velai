import '@testing-library/jest-dom/vitest';

// jsdom no implementa la Popover API (la usan los toasts). Con estos stubs el código
// real corre tal cual; el matches(':popover-open') de los toasts ya va en try/catch.
if (!('showPopover' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { value() {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { value() {}, configurable: true });
}

// jsdom tampoco implementa <dialog>.showModal.
if (!('showModal' in HTMLDialogElement.prototype)) {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    value(this: HTMLDialogElement) {
      this.open = true;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
    configurable: true,
  });
}
