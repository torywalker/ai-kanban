/**
 * The per-card comments-open state survives a relaunch: it is written to
 * localStorage and read back when the store module loads.
 */
describe('uiStore commentsOpen persistence', () => {
  const load = () => {
    let store!: typeof import('@/store/uiStore');
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      store = require('@/store/uiStore');
    });
    return store.useUiStore;
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('restores the cards that were left open', () => {
    load().getState().setCommentsOpen('crd_a', true);
    load().getState().setCommentsOpen('crd_b', true);

    expect(load().getState().commentsOpen).toEqual({
      crd_a: true,
      crd_b: true,
    });
  });

  it('forgets a card once it is closed', () => {
    const store = load();
    store.getState().setCommentsOpen('crd_a', true);
    store.getState().setCommentsOpen('crd_a', false);

    expect(load().getState().commentsOpen).toEqual({});
  });

  it('starts empty when the stored value is corrupt', () => {
    window.localStorage.setItem('ai-kanban.commentsOpen', '{not json');

    expect(load().getState().commentsOpen).toEqual({});
  });

  it('still works when storage throws', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const store = load();

    expect(() => store.getState().setCommentsOpen('crd_a', true)).not.toThrow();
    expect(store.getState().commentsOpen).toEqual({ crd_a: true });
    spy.mockRestore();
  });
});
