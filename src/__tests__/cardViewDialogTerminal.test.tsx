/**
 * Terminal-engine controls in the card view dialog: Run starts a pty
 * instead of an Agent SDK turn, and an open terminal replaces the
 * transcript, the reply box, and the usual Stop/Ship behavior.
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { toast } from 'sonner';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { SessionSnapshot } from '@shared/daemonProtocol';
import { installElectronMock } from '../testUtils/electronMock';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const REPO = '/tmp/some-repo';

function installResizeObserver(): void {
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: () => {},
    unobserve: () => {},
    disconnect: () => {},
  }));
}

function terminalSnapshot(
  cardId: string,
  terminal: { shellAlive: boolean; claudeRunning: boolean },
  status: SessionSnapshot['status'] = 'working',
): SessionSnapshot {
  return {
    cardId,
    sessionId: 'sess_term',
    status,
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    engine: 'terminal',
    terminal,
  };
}

describe('CardViewDialog terminal controls', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  const renderDialog = async () => {
    const view = render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    return view;
  };

  beforeEach(async () => {
    installResizeObserver();
    installElectronMock();
    window.electron.platform = 'darwin';
    window.electron.terminal = {
      start: jest.fn().mockResolvedValue(undefined),
      input: jest.fn(),
      resize: jest.fn(),
      interrupt: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      attach: jest.fn().mockResolvedValue(undefined),
      closeIdle: jest.fn().mockResolvedValue(undefined),
      onData: jest.fn().mockReturnValue(() => {}),
      onReplay: jest.fn().mockReturnValue(() => {}),
    };
    useSessionStore.setState({ sessions: {} });
    useUiStore.setState({ cardDialogExpanded: {} });
    useDocStore.setState({
      approvalMode: 'ask',
      defaultModel: null,
      useWorktrees: false,
      sessionEngine: 'terminal',
      claudeCliPath: null,
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
      prompt: 'hi {{name}}',
    });
    useDocStore.getState().updateCard(boardId, listId, cardId, {
      variables: { name: 'Bo' },
    });
  });

  afterEach(() => {
    cleanup();
    useDocStore.setState({
      sessionEngine: 'sdk',
      claudeCliPath: null,
      useWorktrees: false,
    });
    useSessionStore.setState({ sessions: {} });
  });

  it('starts a terminal and does not call the Agent SDK', async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(window.electron.terminal.start).toHaveBeenCalledWith(
        expect.objectContaining({
          cardId,
          cwd: REPO,
          prompt: 'hi Bo',
          sessionId: null,
          claudeCliPath: null,
          approvalMode: 'ask',
        }),
      );
    });
    expect(window.electron.session.run).not.toHaveBeenCalled();
  });

  it('toasts when starting the terminal fails', async () => {
    (window.electron.terminal.start as jest.Mock).mockRejectedValue(
      new Error('daemon down'),
    );
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('daemon down');
    });
  });

  it('replaces Run and the reply box while a terminal is open', async () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
      );
    await renderDialog();

    expect(
      screen.queryByRole('button', { name: /^Run/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Reply to the agent…'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="dialog-content"]')?.className,
    ).toContain('h-[92vh]');
  });

  it('interrupts the pty when Stop is pressed', async () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
      );
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() =>
      expect(window.electron.terminal.interrupt).toHaveBeenCalledWith(cardId),
    );
  });

  it('confirms before closing a terminal that is still running Claude', async () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
      );
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));

    expect(
      screen.getByText(
        'Claude is still running in this terminal. Close it anyway?',
      ),
    ).toBeInTheDocument();
    expect(window.electron.terminal.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close it' }));

    expect(window.electron.terminal.close).toHaveBeenCalledWith(cardId);
  });

  it('closes an idle terminal without confirming', async () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(
          cardId,
          { shellAlive: true, claudeRunning: false },
          'done',
        ),
      );
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));

    expect(
      screen.queryByText(
        'Claude is still running in this terminal. Close it anyway?',
      ),
    ).not.toBeInTheDocument();
    expect(window.electron.terminal.close).toHaveBeenCalledWith(cardId);
    expect(
      screen.queryByRole('button', { name: /^Run/ }),
    ).not.toBeInTheDocument();
  });

  it('refuses to ship while Claude is running in the terminal', async () => {
    useDocStore.setState({ useWorktrees: true });
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        sessionWorktree: {
          path: '/tmp/worktrees/card',
          branch: 'kanban/card',
          recordedTargetBranch: 'main',
        },
      });
    });
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
      );
    await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Ship' }));

    expect(toast.error).toHaveBeenCalledWith(
      'Exit Claude in the terminal before shipping.',
    );
    expect(window.electron.git.shipPlan).not.toHaveBeenCalled();
  });

  it('keeps the transcript and reply box for a built-in session', async () => {
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        sessionEngine: 'sdk',
      });
    });
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: 'sess_sdk',
      status: 'done',
      checklist: [{ id: 'tu_1', label: 'Read: a.py', done: true, seq: 0 }],
      messages: [],
      pendingApproval: null,
      lastError: null,
    });
    await renderDialog();

    expect(screen.getByText('Read: a.py')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Reply to the agent…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).not.toBeInTheDocument();
  });

  it('closes a live terminal when the card is archived or deleted', () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
      );

    useDocStore.getState().archiveCard(boardId, listId, cardId);
    expect(window.electron.terminal.close).toHaveBeenCalledWith(cardId);

    (window.electron.terminal.close as jest.Mock).mockClear();
    useDocStore.getState().deleteCard(boardId, listId, cardId);
    expect(window.electron.terminal.close).toHaveBeenCalledWith(cardId);
  });

  it('does not close a terminal when the card has no terminal snapshot', () => {
    useDocStore.getState().archiveCard(boardId, listId, cardId);
    useDocStore.getState().deleteCard(boardId, listId, cardId);

    expect(window.electron.terminal.close).not.toHaveBeenCalled();
  });

  it('closes live terminals when a list is deleted or all of its cards are archived', () => {
    const otherId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Other',
      prompt: 'x',
    });
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(
          cardId,
          { shellAlive: true, claudeRunning: false },
          'done',
        ),
      );
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(
          otherId,
          { shellAlive: true, claudeRunning: false },
          'done',
        ),
      );
    const close = window.electron.terminal.close as jest.Mock;

    useDocStore.getState().archiveAllCardsInList(boardId, listId);
    expect(close).toHaveBeenCalledWith(cardId);
    expect(close).toHaveBeenCalledWith(otherId);

    close.mockClear();
    useDocStore.getState().deleteList(boardId, listId);
    expect(close).toHaveBeenCalledWith(cardId);
    expect(close).toHaveBeenCalledWith(otherId);
  });

  it('closes live terminals when the board is deleted', () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(
          cardId,
          { shellAlive: true, claudeRunning: false },
          'done',
        ),
      );

    useDocStore.getState().deleteBoard(boardId);

    expect(window.electron.terminal.close).toHaveBeenCalledWith(cardId);
  });

  it('runs the built-in engine once a terminal has exited and the card is sdk', async () => {
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        sessionEngine: 'sdk',
      });
    });
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: 'sess_old',
      status: 'done',
      checklist: [{ id: 'tu_1', label: 'Read: a.py', done: true, seq: 0 }],
      messages: [],
      pendingApproval: null,
      lastError: null,
      engine: 'terminal',
      terminal: { shellAlive: false, claudeRunning: false },
    });
    await renderDialog();

    expect(screen.getByText('Read: a.py')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Run/ }));

    await waitFor(() => {
      expect(window.electron.session.run).toHaveBeenCalled();
    });
    expect(window.electron.terminal.start).not.toHaveBeenCalled();
  });

  it('shows the SDK approval UI while a conflict turn waits on a terminal card', async () => {
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: 'sess_sdk',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: {
        requestId: 'req_1',
        toolName: 'Bash',
        input: { command: 'git merge main' },
      },
      lastError: null,
    });
    await renderDialog();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).not.toBeInTheDocument();
  });

  it('keeps a live terminal while Ship is busy, and shows approvals for an SDK turn', async () => {
    useSessionStore
      .getState()
      .applySnapshot(
        terminalSnapshot(
          cardId,
          { shellAlive: true, claudeRunning: false },
          'done',
        ),
      );
    (window.electron.git.shipStatusGet as jest.Mock).mockResolvedValue({
      repoKey: REPO,
      active: { cardId, title: 'Runnable card' },
      waiters: [],
    });
    await renderDialog();

    expect(
      screen.getByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await act(async () => {
      useSessionStore.getState().applySnapshot({
        cardId,
        sessionId: 'sess_sdk',
        status: 'waiting',
        checklist: [],
        messages: [],
        pendingApproval: {
          requestId: 'req_1',
          toolName: 'Bash',
          input: { command: 'git merge main' },
        },
        lastError: null,
      });
    });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).not.toBeInTheDocument();
  });

  describe('Escape', () => {
    const renderWithClose = async () => {
      const onOpenChange = jest.fn();
      render(
        <CardViewDialog
          open
          onOpenChange={onOpenChange}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });
      return onOpenChange;
    };

    beforeEach(() => {
      useSessionStore
        .getState()
        .applySnapshot(
          terminalSnapshot(cardId, { shellAlive: true, claudeRunning: true }),
        );
    });

    it('stays open when Escape is pressed inside the terminal', async () => {
      const onOpenChange = await renderWithClose();
      const input = document.createElement('textarea');
      document.querySelector('[data-terminal-host]')!.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('still closes when Escape is pressed outside the terminal', async () => {
      const onOpenChange = await renderWithClose();
      const closeButton = screen.getByRole('button', {
        name: 'Close terminal',
      });
      closeButton.focus();

      fireEvent.keyDown(closeButton, { key: 'Escape' });

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows a failed terminal start under the panel', async () => {
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: null,
      status: 'failed',
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError: 'Working directory does not exist: /nope',
      engine: 'terminal',
      terminal: { shellAlive: false, claudeRunning: false },
    });
    await renderDialog();

    const box = screen.getByText('Working directory does not exist: /nope');
    expect(box.className).toMatch(/destructive/);
    expect(
      screen.getByText(
        'Cost is estimated from token counts for terminal sessions.',
      ),
    ).toBeInTheDocument();
  });

  it('opens large and collapses to the narrow dialog', async () => {
    await renderDialog();
    const content = document.querySelector('[data-slot="dialog-content"]')!;

    expect(
      screen.getByRole('button', { name: 'Collapse' }),
    ).toBeInTheDocument();
    expect(content.className).toContain('sm:max-w-[92vw]');
    expect(content.className).toContain('h-[92vh]');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(content.className).toContain('sm:max-w-2xl');
    expect(content.className).toContain('h-[85vh]');
    expect(content.className).not.toContain('sm:max-w-[92vw]');

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(content.className).toContain('sm:max-w-[92vw]');
  });
});
