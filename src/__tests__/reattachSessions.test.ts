/**
 * `reattachSessions` is the walk-and-query logic AppShell's reattach effect
 * used to run inline on every launch, extracted so the manual "Restart
 * Daemon" action in SettingsDialog can trigger the exact same behaviour
 * on demand rather than only once at mount. AppShell's own
 * `sessionReattach.test.tsx` covers it end-to-end through the component;
 * this file pins down the extracted function directly.
 */
import { reattachSessions } from '@/lib/reattachSessions';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

const CARD_A = 'crd_a';
const CARD_B = 'crd_b';

beforeEach(() => {
  installElectronMock();
  useSessionStore.setState({ sessions: {} });
});

describe('reattachSessions', () => {
  it('applies an optimistic "interrupted" placeholder for every given card before the daemon answers', () => {
    reattachSessions([
      { cardId: CARD_A, sessionId: 'sess_a' },
      { cardId: CARD_B, sessionId: 'sess_b' },
    ]);

    const a = useSessionStore.getState().sessions[CARD_A];
    const b = useSessionStore.getState().sessions[CARD_B];
    expect(a.status).toBe('interrupted');
    expect(a.sessionId).toBe('sess_a');
    expect(a.lastError).toMatch(/reconnect/i);
    expect(b.status).toBe('interrupted');
    expect(b.sessionId).toBe('sess_b');
  });

  it('asks the daemon for the real state of every given card', () => {
    reattachSessions([
      { cardId: CARD_A, sessionId: 'sess_a' },
      { cardId: CARD_B, sessionId: 'sess_b' },
    ]);

    expect(window.electron.session.getState).toHaveBeenCalledWith(CARD_A);
    expect(window.electron.session.getState).toHaveBeenCalledWith(CARD_B);
  });

  describe('give-up timeout when the daemon never answers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('replaces the placeholder with an honest give-up message after 15s of silence', () => {
      reattachSessions([{ cardId: CARD_A, sessionId: 'sess_a' }]);

      jest.advanceTimersByTime(15_000);

      const snapshot = useSessionStore.getState().sessions[CARD_A];
      expect(snapshot.lastError).toMatch(/no record of the session/i);
      expect(snapshot.lastError).toMatch(/run again/i);
      expect(snapshot.status).toBe('interrupted');
      expect(snapshot.sessionId).toBe('sess_a');
    });

    it('does not overwrite a real snapshot that arrived before the timeout', () => {
      reattachSessions([{ cardId: CARD_A, sessionId: 'sess_a' }]);

      useSessionStore.getState().applySnapshot({
        cardId: CARD_A,
        sessionId: 'sess_a',
        status: 'done',
        checklist: [],
        messages: [],
        pendingApproval: null,
        lastError: null,
      });

      jest.advanceTimersByTime(15_000);

      const snapshot = useSessionStore.getState().sessions[CARD_A];
      expect(snapshot.status).toBe('done');
      expect(snapshot.lastError).toBeNull();
    });

    it('lets the caller cancel the pending give-up timers via the returned cleanup', () => {
      const cleanup = reattachSessions([
        { cardId: CARD_A, sessionId: 'sess_a' },
      ]);
      cleanup();

      jest.advanceTimersByTime(15_000);

      const snapshot = useSessionStore.getState().sessions[CARD_A];
      expect(snapshot.lastError).toMatch(/reconnect/i);
    });
  });
});
