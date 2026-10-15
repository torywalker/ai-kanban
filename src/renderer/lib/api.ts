import type { ElectronApi } from '../../main/preload';

/**
 * Reads `window.electron` lazily on every property access rather than
 * capturing it once at module-evaluation time. In production the preload
 * script has already run by the time this module loads, so it would not
 * matter either way; in tests, `window.electron` is stubbed after this
 * module is imported (Jest hoists imports above `beforeAll`), so an eager
 * capture would freeze on `undefined`.
 */
export const api: ElectronApi = new Proxy({} as ElectronApi, {
  get(_target, prop: keyof ElectronApi) {
    return window.electron[prop];
  },
});
