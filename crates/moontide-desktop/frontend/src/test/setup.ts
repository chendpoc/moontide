// Vitest/jsdom polyfills for bits-ui ScrollArea (ResizeObserver).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];
    const minWidth = /min-width:\s*(\d+)px/.exec(query)?.[1];
    const matches =
      query === "(prefers-color-scheme: dark)"
        ? false
        : (maxWidth === undefined || window.innerWidth <= Number(maxWidth)) &&
          (minWidth === undefined || window.innerWidth >= Number(minWidth));

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  },
});
