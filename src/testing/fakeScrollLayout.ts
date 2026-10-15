/**
 * Test support: a minimal fake layout for scroll offsets under jsdom.
 *
 * jsdom performs no layout at all — every element reports `scrollHeight`,
 * `clientHeight` and `scrollTop` as a hard-coded `0`, and its `scrollTop`
 * setter is a no-op. Anything that reads or writes a scroll offset is
 * therefore untestable as shipped: the production code can be perfectly
 * correct and the assertion still sees `0`, and a regression that stops
 * scrolling entirely looks identical to a pass.
 *
 * This installs just enough fake geometry on `HTMLElement.prototype` to
 * make that behavior observable:
 *
 *   - `scrollTop` becomes a real per-element stored value (so a write is
 *     readable back, and a test can also play the part of the user by
 *     assigning one and dispatching `scroll`).
 *   - `scrollHeight` is derived from how many element children a container
 *     renders, so appending rows to a list grows its scroll height the way
 *     a browser would — which is what makes "did it follow the new
 *     content?" an assertion with real teeth rather than `0 === 0`.
 *   - `clientHeight` is a fixed viewport height for every container.
 *
 * Lives outside `src/__tests__/` deliberately: Jest's default `testMatch`
 * treats every `.ts`/`.tsx` file under a `__tests__` directory as a test
 * suite, and a helper module placed there would fail as a suite with no
 * tests in it.
 */
export interface FakeScrollLayoutOptions {
  /** Height each element child contributes to its parent's `scrollHeight`. */
  rowHeight?: number;
  /** Visible height reported by every scroll container. */
  clientHeight?: number;
}

const GEOMETRY = ['scrollTop', 'scrollHeight', 'clientHeight'] as const;

/**
 * Returns the uninstall function — always call it (an `afterEach`, or a
 * `finally`), since these descriptors are global to the jsdom realm and
 * would otherwise leak fake geometry into unrelated suites in the same
 * file.
 */
export function installFakeScrollLayout({
  rowHeight = 100,
  clientHeight = 100,
}: FakeScrollLayoutOptions = {}): () => void {
  const proto = HTMLElement.prototype;
  // jsdom defines these on `Element.prototype`, so there is normally no own
  // descriptor here to save; shadowing on `HTMLElement.prototype` and then
  // deleting restores the real accessors by way of the prototype chain.
  const saved = GEOMETRY.map(
    (name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const,
  );
  const offsets = new WeakMap<HTMLElement, number>();

  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return offsets.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      offsets.set(this, value);
    },
  });
  Object.defineProperty(proto, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.children.length * rowHeight;
    },
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get() {
      return clientHeight;
    },
  });

  return () => {
    saved.forEach(([name, descriptor]) => {
      if (descriptor) {
        Object.defineProperty(proto, name, descriptor);
      } else {
        delete (proto as unknown as Record<string, unknown>)[name];
      }
    });
  };
}
