/**
 * Final whole-branch review, fixes C3 (renderer side), I1 (UI hardening)
 * and I4 — all in `CardViewDialog`.
 *
 *   C3: `reply` carried no working directory, so the daemon fell back to
 *       `process.cwd()` — its own inherited directory — and ran
 *       Write/Edit/Bash against the wrong repo. The renderer now sends the
 *       same `cwd` it already computed for `run`, and refuses to send
 *       without one.
 *   I1: Send is disabled while a turn is in flight — `working` AND
 *       `waiting` — so the user is not invited to trigger the reply the
 *       daemon's in-flight guard silently refuses. (The `waiting` half was
 *       corrected in fix round 3: when this test was first written every
 *       tool call was auto-approved, so `waiting` was unreachable and the
 *       reply box was left live there; once `canUseTool` actually gates
 *       every tool call, `waiting` became the state every tool call passes
 *       through and a reply sent there was silently discarded.)
 *   I4: `run`/`sendReply`/Stop had no error handling. A daemon that can't be
 *       spawned or reached rejects the IPC promise, and since no snapshot
 *       event ever arrives the UI showed nothing at all — the silent hang
 *       spec §7 forbids.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import type { SessionStatus } from '@shared/daemonProtocol';
import { installFakeScrollLayout } from '../testing/fakeScrollLayout';
import {
  rejectTurnSnapshot,
  TURN_IN_PROGRESS_ERROR,
} from '../main/daemon/turnLifecycle';
import { installElectronMock } from '../testUtils/electronMock';

const REPO = '/tmp/some-repo';

describe('CardViewDialog session controls', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  const seedSnapshot = (status: SessionStatus) =>
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: 'sess_live',
      status,
      checklist: [{ id: 'tu_1', label: 'Read: a.py', done: false, seq: 0 }],
      messages: [],
      pendingApproval: null,
      lastError: null,
    });

  const renderDialog = () =>
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    useDocStore.setState({
      approvalMode: 'ask',
      defaultModel: null,
      useWorktrees: false,
    });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists[0].cards = [];
    });
    useDocStore.getState().setBoardDefaultRepo(boardId, REPO);
    cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Runnable card',
      prompt: 'Fix the thing.',
    });
  });

  it('substitutes the card’s stored variables before starting the agent', async () => {
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        prompt: 'Fix {{ target }} and leave {{missing}} visible.',
        variables: { target: 'authentication' },
      });
    });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(window.electron.session.run).toHaveBeenCalledWith(
        cardId,
        'Fix authentication and leave {{missing}} visible.',
        REPO,
        'ask',
        null,
        [],
      );
    });
  });

  describe('worktree Run and Ship controls', () => {
    const attachWorktree = () => {
      const worktree = {
        path: `/tmp/worktrees/${cardId}`,
        branch: `kanban/${cardId}`,
        recordedTargetBranch: 'main',
      };
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { sessionWorktree: worktree });
      });
      return worktree;
    };

    it('ensures a worktree and runs the session inside it when enabled', async () => {
      const worktree = {
        path: `/tmp/worktrees/${cardId}`,
        branch: `kanban/${cardId}`,
        recordedTargetBranch: 'main',
      };
      useDocStore.setState({ useWorktrees: true });
      (window.electron.git.ensureWorktree as jest.Mock).mockResolvedValue({
        ok: true,
        value: worktree,
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      await waitFor(() => {
        expect(window.electron.git.ensureWorktree).toHaveBeenCalledWith(
          cardId,
          REPO,
          null,
        );
        expect(window.electron.session.run).toHaveBeenCalledWith(
          cardId,
          'Fix the thing.',
          worktree.path,
          'ask',
          null,
          [],
        );
      });
      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
          .sessionWorktree,
      ).toEqual(worktree);
    });

    it('runs in the primary repo without ensuring a worktree when disabled', async () => {
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      await waitFor(() =>
        expect(window.electron.session.run).toHaveBeenCalledWith(
          cardId,
          'Fix the thing.',
          REPO,
          'ask',
          null,
          [],
        ),
      );
      expect(window.electron.git.ensureWorktree).not.toHaveBeenCalled();
    });

    it('shows Ship only for a finished worktree session and keeps the branch out of the button name', async () => {
      useDocStore.setState({ useWorktrees: true });
      attachWorktree();
      act(() => seedSnapshot('done'));
      renderDialog();

      expect(screen.getByRole('button', { name: 'Ship' })).toBeInTheDocument();
      await waitFor(() =>
        expect(window.electron.git.shipPlan).toHaveBeenCalled(),
      );
      expect(screen.queryByText('Merges into main')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /main/ }),
      ).not.toBeInTheDocument();
    });

    it('does not show Ship without a session worktree', () => {
      useDocStore.setState({ useWorktrees: true });
      act(() => seedSnapshot('done'));
      renderDialog();

      expect(
        screen.queryByRole('button', { name: 'Ship' }),
      ).not.toBeInTheDocument();
    });

    it('asks between full recorded and current branch names before shipping', async () => {
      useDocStore.setState({ useWorktrees: true });
      const worktree = attachWorktree();
      act(() => seedSnapshot('done'));
      (window.electron.git.shipPlan as jest.Mock).mockResolvedValue({
        ok: true,
        value: {
          kind: 'choose',
          recorded: 'feature/the-original-very-long-branch-name',
          current: 'release/the-current-very-long-branch-name',
        },
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Ship' }));
      expect(
        await screen.findByRole('heading', {
          name: 'Merge into which branch?',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Ship into feature/the-original-very-long-branch-name',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Ship into release/the-current-very-long-branch-name',
        }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Ship into feature/the-original-very-long-branch-name',
        }),
      );

      await waitFor(() => {
        expect(window.electron.git.ship).toHaveBeenCalledWith(
          expect.objectContaining({
            cardId,
            primary: REPO,
            worktree,
            destinationBranch: 'feature/the-original-very-long-branch-name',
          }),
        );
      });
      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
          .sessionWorktree,
      ).toBeNull();
    });

    it('cancels the branch chooser without starting Ship', async () => {
      useDocStore.setState({ useWorktrees: true });
      attachWorktree();
      act(() => seedSnapshot('done'));
      (window.electron.git.shipPlan as jest.Mock).mockResolvedValue({
        ok: true,
        value: {
          kind: 'choose',
          recorded: 'main',
          current: 'release',
        },
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Ship' }));
      await screen.findByRole('heading', {
        name: 'Merge into which branch?',
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(window.electron.git.ship).not.toHaveBeenCalled();
    });

    it('clears stale metadata when the worktree is missing at Ship', async () => {
      useDocStore.setState({ useWorktrees: true });
      attachWorktree();
      act(() => seedSnapshot('done'));
      (window.electron.git.ship as jest.Mock).mockResolvedValue({
        ok: false,
        error: 'The card worktree no longer exists.',
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Ship' }));

      await waitFor(() => {
        expect(
          useDocStore
            .getState()
            .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
            .sessionWorktree,
        ).toBeNull();
      });
    });

    it('keeps the worktree and does not run when worktree creation fails', async () => {
      useDocStore.setState({ useWorktrees: true });
      (window.electron.git.ensureWorktree as jest.Mock).mockResolvedValue({
        ok: false,
        error: 'Cannot start a worktree from a detached HEAD.',
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      expect(
        await screen.findByText(
          'Cannot start a worktree from a detached HEAD.',
        ),
      ).toBeInTheDocument();
      expect(window.electron.session.run).not.toHaveBeenCalled();
      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
          .sessionWorktree,
      ).toBeNull();
    });

    it('replies inside the existing worktree even if the global default is later disabled', async () => {
      const worktree = attachWorktree();
      act(() => seedSnapshot('done'));
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'continue there' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalledWith(
          cardId,
          'continue there',
          worktree.path,
          'ask',
          null,
          'sess_live',
          [],
        );
      });
    });

    it('cancels Ship when Stop is used', async () => {
      act(() => seedSnapshot('working'));
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

      await waitFor(() => {
        expect(window.electron.git.shipCancel).toHaveBeenCalledWith(cardId);
        expect(window.electron.session.stop).toHaveBeenCalledWith(cardId);
      });
    });

    it('hydrates queue status on open and disables a waiting Ship', async () => {
      useDocStore.setState({ useWorktrees: true });
      attachWorktree();
      act(() => seedSnapshot('done'));
      (window.electron.git.shipStatusGet as jest.Mock).mockResolvedValue({
        repoKey: REPO,
        active: { cardId: 'crd_ahead', title: 'Ahead of me' },
        waiters: [{ cardId, title: 'Runnable card' }],
      });
      renderDialog();

      await waitFor(() =>
        expect(window.electron.git.shipStatusGet).toHaveBeenCalledWith(cardId),
      );
      expect(
        await screen.findByRole('button', { name: 'Ship' }),
      ).toBeDisabled();
      expect(
        screen.getByText('Waiting to ship (behind “Ahead of me”)'),
      ).toBeInTheDocument();
    });

    it('reacts to queue events emitted after the dialog opens', async () => {
      useDocStore.setState({ useWorktrees: true });
      attachWorktree();
      act(() => seedSnapshot('done'));
      let onStatus:
        | ((snapshot: {
            repoKey: string;
            active: { cardId: string; title: string } | null;
            waiters: { cardId: string; title: string }[];
          }) => void)
        | null = null;
      (window.electron.git.onShipStatus as jest.Mock).mockImplementation(
        (listener) => {
          onStatus = listener;
          return () => {};
        },
      );
      renderDialog();

      act(() => {
        onStatus?.({
          repoKey: REPO,
          active: { cardId: 'crd_ahead', title: 'First card' },
          waiters: [{ cardId, title: 'Runnable card' }],
        });
      });

      expect(screen.getByRole('button', { name: 'Ship' })).toBeDisabled();
      expect(
        screen.getByText('Waiting to ship (behind “First card”)'),
      ).toBeInTheDocument();
    });
  });

  describe('C3: reply carries the card’s working directory', () => {
    it('sends the resolved cwd as the third argument to session.reply', async () => {
      act(() => seedSnapshot('done'));
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'try again please' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalledWith(
          cardId,
          'try again please',
          REPO,
          'ask',
          null,
          // Persisted by the sessionId-capture effect once `seedSnapshot`
          // reports `sessionId: 'sess_live'` — see that effect's own
          // comment in CardViewDialog.tsx.
          'sess_live',
          [],
        );
      });
    });

    it('prefers the card’s own repo override over the board default', async () => {
      act(() => {
        useDocStore
          .getState()
          .setCardSessionRepo(boardId, listId, cardId, '/tmp/card-override');
        seedSnapshot('done');
      });
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'hello' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalledWith(
          cardId,
          'hello',
          '/tmp/card-override',
          'ask',
          null,
          'sess_live',
          [],
        );
      });
    });

    /**
     * Lets a reply resume the real Claude conversation even after the
     * daemon has no live in-memory record of this card at all — a fresh
     * daemon following a crash, or the app relaunching after the previous
     * one was killed. Before this, `reply` only ever resumed using the
     * DAEMON's own in-memory session id, so a reply sent in exactly this
     * situation silently started a brand-new conversation with no
     * knowledge of the original prompt.
     */
    it('passes the persisted card.sessionId so a fresh daemon (no live record) can still resume', async () => {
      act(() => {
        useDocStore
          .getState()
          .setCardSessionId(boardId, listId, cardId, 'sess_from_before');
        // Simulates AppShell's reattach placeholder after a daemon that
        // never answered — a snapshot exists so the reply box is enabled,
        // but it carries no daemon-side session state at all.
        useSessionStore.getState().applySnapshot({
          cardId,
          sessionId: 'sess_from_before',
          status: 'failed',
          checklist: [],
          messages: [],
          pendingApproval: null,
          lastError: 'Could not reconnect to the previous session.',
        });
      });
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'continue where we left off' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalledWith(
          cardId,
          'continue where we left off',
          REPO,
          'ask',
          null,
          'sess_from_before',
          [],
        );
      });
    });

    it('refuses to send a reply with no working directory at all', async () => {
      act(() => {
        useDocStore.getState().setBoardDefaultRepo(boardId, null);
        seedSnapshot('done');
      });
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'nowhere to run' },
      });
      const send = screen.getByRole('button', { name: 'Send' });
      expect(send).toBeDisabled();
      fireEvent.click(send);
      expect(window.electron.session.reply).not.toHaveBeenCalled();
    });
  });

  describe('I1: Send is disabled while a turn is in flight', () => {
    it('disables Send while the agent is working', () => {
      act(() => seedSnapshot('working'));
      renderDialog();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('enables Send once the turn has finished', () => {
      act(() => seedSnapshot('done'));
      renderDialog();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByPlaceholderText(/reply to the agent/i)).toBeEnabled();
      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'ready' },
      });
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('does not send on Enter while the agent is working either', () => {
      act(() => seedSnapshot('working'));
      renderDialog();
      const input = screen.getByPlaceholderText(/reply to the agent/i);
      fireEvent.change(input, { target: { value: 'sneaky' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(window.electron.session.reply).not.toHaveBeenCalled();
    });
  });

  describe('reply Enter sends; Shift/Alt+Enter start a new line', () => {
    const typeReply = (value: string) => {
      const input = screen.getByPlaceholderText(/reply to the agent/i);
      fireEvent.change(input, { target: { value } });
      return input;
    };

    it('sends on unmodified Enter', async () => {
      act(() => seedSnapshot('done'));
      renderDialog();
      fireEvent.keyDown(typeReply('try again please'), { key: 'Enter' });

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalled();
      });
    });

    it('does not send on Shift+Enter', () => {
      act(() => seedSnapshot('done'));
      renderDialog();
      const input = typeReply('first line');
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
      expect(window.electron.session.reply).not.toHaveBeenCalled();
    });

    it('does not send on Alt+Enter', () => {
      act(() => seedSnapshot('done'));
      renderDialog();
      fireEvent.keyDown(typeReply('first line'), {
        key: 'Enter',
        altKey: true,
      });
      expect(window.electron.session.reply).not.toHaveBeenCalled();
    });

    it('does not send Enter while an IME composition is active', () => {
      act(() => seedSnapshot('done'));
      renderDialog();
      fireEvent.keyDown(typeReply('変換中'), {
        key: 'Enter',
        isComposing: true,
      });
      expect(window.electron.session.reply).not.toHaveBeenCalled();
    });
  });

  /**
   * Fix round 3. The daemon's in-flight guard treats `waiting` (parked
   * inside `canUseTool` awaiting Approve/Deny) exactly like `working`: the
   * turn is still active, so a `reply` is refused and reported by setting
   * `lastError` while LEAVING `status` at `waiting`. Before this round the
   * UI let the user send there anyway, cleared the input the moment the IPC
   * promise resolved (it resolves fine — the refusal is snapshot-level, not
   * a promise rejection), and rendered `lastError` only for
   * `status === 'failed'`. The user therefore saw their message vanish and
   * nothing else happen, ever: the silent hang spec §7 forbids.
   */
  describe('fix round 3: a reply cannot silently vanish during `waiting`', () => {
    const seedPendingApproval = () =>
      useSessionStore.getState().applySnapshot({
        cardId,
        sessionId: 'sess_live',
        status: 'waiting',
        checklist: [
          { id: 'tu_1', label: 'Write: out.txt', done: false, seq: 0 },
        ],
        messages: [],
        pendingApproval: {
          requestId: 'req_1',
          toolName: 'Write',
          input: { file_path: '/tmp/some-repo/out.txt' },
        },
        lastError: null,
      });

    it('disables Send and the input, and says why, while an approval is pending', () => {
      act(() => seedPendingApproval());
      renderDialog();

      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByPlaceholderText(/reply to the agent/i)).toBeDisabled();
      expect(
        screen.getByText(/approve or deny the request above before replying/i),
      ).toBeInTheDocument();
      // Approve/Deny — the action that IS available here — is still offered.
      expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    });

    it('never dispatches the reply, and keeps the typed text, during `waiting`', () => {
      act(() => seedPendingApproval());
      renderDialog();

      const input = screen.getByPlaceholderText(
        /reply to the agent/i,
      ) as HTMLInputElement;
      // `fireEvent.change` bypasses the DOM's own disabled-input handling, so
      // this also proves the Send/Enter paths refuse the value even if text
      // somehow gets in.
      fireEvent.change(input, {
        target: { value: 'never mind, do it differently' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(window.electron.session.reply).not.toHaveBeenCalled();
      expect(input.value).toBe('never mind, do it differently');
    });

    it('surfaces the daemon’s refusal message even though status stays `waiting`', () => {
      act(() => seedPendingApproval());
      renderDialog();

      // Exactly what the daemon broadcasts when its in-flight guard refuses a
      // reply: `rejectTurnSnapshot` sets `lastError` and touches nothing else.
      act(() => {
        const previous = useSessionStore.getState().sessions[cardId];
        useSessionStore.getState().applySnapshot(rejectTurnSnapshot(previous));
      });

      expect(useSessionStore.getState().sessions[cardId].status).toBe(
        'waiting',
      );
      expect(screen.getByText(TURN_IN_PROGRESS_ERROR)).toBeInTheDocument();
    });
  });

  /**
   * Clicking Run showed nothing at all until the daemon's first broadcast —
   * the card had no session entry, so the transcript rendered null, and the
   * first snapshot then arrived as a `working` turn with an empty feed: a
   * sliver of padding. Both windows are covered by writing the turn's
   * opening snapshot locally, which the daemon's own first broadcast then
   * replaces (see `pendingRunSnapshot`).
   */
  describe('a dispatched turn is visible before the daemon answers', () => {
    it('shows the startup notice as soon as Run is clicked', () => {
      renderDialog();
      // Nothing has run yet, so there is no transcript to speak of.
      expect(screen.queryByText(/starting the agent/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      // No snapshot event has been delivered — this is the local write.
      expect(screen.getByText(/starting the agent/i)).toBeInTheDocument();
      expect(useSessionStore.getState().sessions[cardId].status).toBe(
        'working',
      );
    });

    it('keeps the user’s reply on screen while the agent spins up', () => {
      act(() => seedSnapshot('done'));
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'check the tests too' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      // Scoped to the transcript feed: React mirrors a controlled
      // textarea's value into its own text content, so an unscoped query
      // would match the reply box itself and prove nothing.
      const feed = screen.getByRole('list');
      expect(within(feed).getByText('check the tests too')).toBeInTheDocument();
      expect(screen.getByText(/waiting for the agent/i)).toBeInTheDocument();
    });
  });

  describe('I4: an unreachable daemon surfaces an error instead of hanging silently', () => {
    it('renders the run failure in the transcript error box', async () => {
      (window.electron.session.run as jest.Mock).mockRejectedValue(
        new Error('spawn daemon ENOENT'),
      );
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      expect(
        await screen.findByText('spawn daemon ENOENT'),
      ).toBeInTheDocument();
      const snapshot = useSessionStore.getState().sessions[cardId];
      expect(snapshot.status).toBe('failed');
      expect(snapshot.lastError).toBe('spawn daemon ENOENT');
    });

    it('renders a reply failure without clearing what the user typed', async () => {
      act(() => seedSnapshot('done'));
      (window.electron.session.reply as jest.Mock).mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );
      renderDialog();

      const input = screen.getByPlaceholderText(
        /reply to the agent/i,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'still needed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(
        await screen.findByText('connect ECONNREFUSED'),
      ).toBeInTheDocument();
      // The message never reached the daemon, so it must not be thrown away.
      expect(input.value).toBe('still needed');
    });

    it('renders a stop failure (the Stop button is awaited, not fire-and-forget)', async () => {
      act(() => seedSnapshot('working'));
      (window.electron.session.stop as jest.Mock).mockRejectedValue(
        new Error('daemon gone'),
      );
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

      expect(await screen.findByText('daemon gone')).toBeInTheDocument();
      expect(useSessionStore.getState().sessions[cardId].status).toBe('failed');
    });

    it('preserves the existing checklist when synthesizing the failure snapshot', async () => {
      act(() => seedSnapshot('done'));
      (window.electron.session.reply as jest.Mock).mockRejectedValue(
        new Error('nope'),
      );
      renderDialog();

      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'x' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(useSessionStore.getState().sessions[cardId].lastError).toBe(
          'nope',
        );
      });
      const snapshot = useSessionStore.getState().sessions[cardId];
      expect(snapshot.checklist).toEqual([
        { id: 'tu_1', label: 'Read: a.py', done: false, seq: 0 },
      ]);
      expect(snapshot.sessionId).toBe('sess_live');
    });
  });

  describe('image attachments', () => {
    const attachment = {
      id: 'att_card',
      filename: 'card.png',
      mimeType: 'image/png' as const,
    };
    const replyAttachment = {
      id: 'att_reply',
      filename: 'reply.png',
      mimeType: 'image/png' as const,
    };

    it('expands a card attachment from inside the view dialog', async () => {
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { attachments: [attachment] });
      });
      renderDialog();

      fireEvent.click(
        await screen.findByRole('button', { name: 'Expand card.png' }),
      );

      const preview = await screen.findByRole('dialog', { name: 'card.png' });
      expect(
        within(preview).getByRole('img', { name: 'card.png' }),
      ).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    });

    it('sends the card attachment refs with Run', async () => {
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { attachments: [attachment] });
      });
      renderDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Run' }));

      await waitFor(() => {
        expect(window.electron.session.run).toHaveBeenCalledWith(
          cardId,
          'Fix the thing.',
          REPO,
          'ask',
          null,
          [{ ...attachment, cardId }],
        );
      });
    });

    it('sends reply attachment refs and clears their state after success', async () => {
      act(() => seedSnapshot('done'));
      (window.electron.attachments.pick as jest.Mock).mockResolvedValue({
        ok: true,
        value: {
          added: [replyAttachment],
          skippedCap: false,
          errors: [],
        },
      });
      renderDialog();

      fireEvent.click(screen.getAllByLabelText('Attach images')[1]);
      expect(await screen.findByAltText('reply.png')).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText(/reply to the agent/i), {
        target: { value: 'look at this' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(window.electron.session.reply).toHaveBeenCalledWith(
          cardId,
          'look at this',
          REPO,
          'ask',
          null,
          'sess_live',
          [{ ...replyAttachment, cardId }],
        );
      });
      await waitFor(() => {
        expect(screen.queryByAltText('reply.png')).not.toBeInTheDocument();
      });
      expect(window.electron.attachments.remove).not.toHaveBeenCalled();
    });

    it('keeps Send disabled for image-only replies', async () => {
      act(() => seedSnapshot('done'));
      (window.electron.attachments.pick as jest.Mock).mockResolvedValue({
        ok: true,
        value: {
          added: [replyAttachment],
          skippedCap: false,
          errors: [],
        },
      });
      renderDialog();

      fireEvent.click(screen.getAllByLabelText('Attach images')[1]);
      expect(await screen.findByAltText('reply.png')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    /**
     * Fix round 1, mirroring the composer's own regression test: the card
     * ingest target must resolve the card's attachments when each write
     * lands, not when the paste handler was created, or the second of two
     * overlapping pastes writes a list that never held the first image.
     */
    it('keeps both batches when two card pastes overlap', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const imageFile = (name: string) => {
        const file = new File([bytes], name, { type: 'image/png' });
        if (typeof file.arrayBuffer !== 'function') {
          Object.defineProperty(file, 'arrayBuffer', {
            value: async () => bytes.buffer,
          });
        }
        return file;
      };
      const pasteInit = (file: File) => ({
        clipboardData: {
          items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
          files: [file],
          getData: () => '',
        },
      });

      const finishWrite: Array<() => void> = [];
      (window.electron.attachments.add as jest.Mock).mockImplementation(
        (_cardId: string, filename: string) =>
          new Promise((resolve) => {
            finishWrite.push(() =>
              resolve({
                ok: true,
                value: {
                  id: `att_${filename.charAt(0)}`,
                  filename,
                  mimeType: 'image/png',
                },
              }),
            );
          }),
      );

      renderDialog();
      const dialog = screen.getByRole('dialog');
      fireEvent.paste(dialog, pasteInit(imageFile('a.png')));
      fireEvent.paste(dialog, pasteInit(imageFile('b.png')));

      await waitFor(() => expect(finishWrite).toHaveLength(2));
      await act(async () => {
        finishWrite[0]();
        finishWrite[1]();
      });

      await waitFor(() => {
        const card = useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId)!;
        expect(card.attachments.map((a) => a.filename)).toEqual([
          'a.png',
          'b.png',
        ]);
      });
    });

    it('keeps Run disabled for a whitespace-only prompt with images', () => {
      act(() => {
        useDocStore.getState().updateCard(boardId, listId, cardId, {
          prompt: '   ',
          attachments: [attachment],
        });
      });
      renderDialog();

      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    });
  });

  /**
   * The dialog body is a single scroll region (prompt, notes, transcript,
   * reply row), so on a short window the transcript — the part that
   * changes while a session runs — starts below the fold. Opening a card
   * with a live session therefore showed the prompt the user already knows
   * and hid the agent's latest message. A card with no session keeps its
   * top edge: there, the body's content is a prompt to be read from the
   * beginning, not a conversation to catch up on.
   */
  describe('opening a card lands on the newest part of the conversation', () => {
    let uninstall: () => void;

    beforeEach(() => {
      uninstall = installFakeScrollLayout();
    });

    afterEach(() => {
      uninstall();
    });

    /** The dialog's one scrollable region, found via the transcript inside it. */
    const dialogBody = () =>
      screen.getByRole('list').parentElement!.closest('.overflow-y-auto')!;

    it('opens the body scrolled to the bottom when the card has a session', () => {
      act(() => seedSnapshot('done'));
      renderDialog();

      const body = dialogBody();
      // Without this the assertion below would hold trivially at 0 === 0.
      expect(body.scrollHeight).toBeGreaterThan(0);
      expect(body.scrollTop).toBe(body.scrollHeight);
    });

    it('leaves the body at the top when the card has no session', () => {
      renderDialog();

      // Found via the prompt block rather than the transcript (there is no
      // transcript without a session); `.parentElement` first because the
      // prompt block is itself a capped scroll region.
      const body = screen
        .getByText('Fix the thing.')
        .parentElement!.closest('.overflow-y-auto')!;
      expect(body.scrollHeight).toBeGreaterThan(0);
      expect(body.scrollTop).toBe(0);
    });
  });
});
