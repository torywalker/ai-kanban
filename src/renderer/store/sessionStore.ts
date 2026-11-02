import { create } from 'zustand';
import type { SessionSnapshot } from '@shared/daemonProtocol';
import { api } from '@/lib/api';
import {
  playTaskFinishedSound,
  playNeedsInputSound,
} from '@/lib/notificationSound';
import showTaskFinishedNotification from '@/lib/nativeNotification';

interface SessionStore {
  sessions: Record<string, SessionSnapshot>;
  /**
   * Cards Claude has finished or asked a question on since the user last
   * opened them. Transient (not persisted): after a restart nothing is
   * flagged, same as the chimes.
   */
  unread: Record<string, boolean>;
  markRead: (cardId: string) => void;
  applySnapshot: (snapshot: SessionSnapshot) => void;
  clearSession: (cardId: string) => void;
  markReattaching: (cardId: string) => void;
}

// Cards currently waiting on the reply to a `getState()` query issued by
// AppShell's reattach effect (see AppShell.tsx: on every app launch, it
// seeds an `interrupted` placeholder for every card with a sessionId --
// including cards that finished long ago -- then asks the daemon for the
// real status). That reply just reports whatever the daemon's record
// already was; it is not a live "just happened" event, so it must not be
// diffed against the placeholder the way a genuine transition would be --
// otherwise every already-finished card chimes again on every restart.
// Module-scoped (not store state): purely internal bookkeeping, never
// rendered.
const pendingReattachCardIds = new Set<string>();

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  unread: {},

  markRead: (cardId) =>
    set((state) => {
      if (!state.unread[cardId]) return state;
      const next = { ...state.unread };
      delete next[cardId];
      return { unread: next };
    }),

  applySnapshot: (snapshot) => {
    const previousStatus = get().sessions[snapshot.cardId]?.status;
    set((state) => ({
      sessions: { ...state.sessions, [snapshot.cardId]: snapshot },
    }));
    // Chime only on an actual transition: never on a card's first snapshot
    // (which would replay old news the instant a session is opened) and
    // never when a snapshot repeats the same status. Checked before
    // consuming the pending-reattach flag below so a same-status update
    // (e.g. AppShell's 15s "still reconnecting" timeout, which only
    // rewrites lastError) never consumes it -- otherwise a real reply that
    // arrives later would wrongly look like a live transition instead.
    if (!previousStatus || previousStatus === snapshot.status) return;
    // The first snapshot to resolve a reattach placeholder answers "what
    // was already true", not "what just happened" -- consume the flag and
    // apply the status silently, with no chime.
    if (pendingReattachCardIds.delete(snapshot.cardId)) return;
    if (snapshot.status === 'done' || snapshot.status === 'waiting') {
      set((state) => ({ unread: { ...state.unread, [snapshot.cardId]: true } }));
    }
    if (snapshot.status === 'done') {
      // `done` is emitted only after the SDK iterator has closed, so any
      // foreground/background Claude work for this card has drained.
      playTaskFinishedSound();
      showTaskFinishedNotification(snapshot.cardId);
    } else if (snapshot.status === 'waiting') {
      playNeedsInputSound();
    }
  },

  clearSession: (cardId) =>
    set((state) => {
      const next = { ...state.sessions };
      delete next[cardId];
      const unread = { ...state.unread };
      delete unread[cardId];
      return { sessions: next, unread };
    }),

  markReattaching: (cardId) => {
    pendingReattachCardIds.add(cardId);
  },
}));

/**
 * Wires the main-process snapshot broadcast into this store. Call once,
 * from AppShell, the same lifecycle as `startPersistence()`.
 */
export function startSessionSubscription(): () => void {
  return api.session.onSnapshot((snapshot) => {
    useSessionStore.getState().applySnapshot(snapshot);
  });
}
