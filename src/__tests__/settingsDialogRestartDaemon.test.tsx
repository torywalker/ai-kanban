/**
 * "Restart Daemon" is a manual escape hatch for a wedged session daemon:
 * it kills the background process every card's agent session talks to,
 * which is disruptive enough (every card's session goes through a
 * reconnect) that it must be gated behind an explicit confirmation before
 * anything actually happens.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import type { SessionSnapshot } from '@shared/daemonProtocol';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

const CARD_WITH_SESSION = 'crd_live01';

function seededDoc(): KanbanDoc {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd1',
        name: 'Board',
        defaultRepo: '/tmp',
        archived: false,
        scratchpad: '',
        lists: [
          {
            id: 'lst1',
            name: 'List',
            cards: [
              {
                id: CARD_WITH_SESSION,
                title: 'Had a live session',
                prompt: 'Do the thing.',
                tags: [],
                notes: '',
                link: '',
                variables: {},
                copyCount: 0,
                lastCopiedAt: null,
                priority: null,
                color: null,
                dueDate: null,
                sessionTool: 'claude',
                sessionRepo: '/tmp',
                sessionId: 'sess_before_restart',
                sessionModel: null,
                useWorktree: null,
                sessionEngine: null,
                sessionWorktree: null,
                usedWorktree: null,
                archived: false,
                attachments: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  installElectronMock();
  useSessionStore.setState({ sessions: {} });
  useDocStore.setState({ doc: seededDoc() });
});

describe('SettingsDialog "Restart Daemon"', () => {
  it('does not restart the daemon until the warning is confirmed', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));

    expect(screen.getByText('Restart Daemon?')).toBeInTheDocument();
    expect(screen.getByText(/disconnect all cards/i)).toBeInTheDocument();
    expect(window.electron.session.restartDaemon).not.toHaveBeenCalled();
  });

  it('restarts the daemon once the warning is confirmed', async () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart the daemon' }));

    await waitFor(() =>
      expect(window.electron.session.restartDaemon).toHaveBeenCalledTimes(1),
    );
  });

  it('does not restart the daemon when the warning is cancelled', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(window.electron.session.restartDaemon).not.toHaveBeenCalled();
    expect(screen.queryByText('Restart Daemon?')).not.toBeInTheDocument();
  });

  it('re-queries every card with a session once the daemon is back up', async () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart the daemon' }));

    await waitFor(() =>
      expect(window.electron.session.getState).toHaveBeenCalledWith(
        CARD_WITH_SESSION,
      ),
    );
  });

  it('does not mention terminals in the restart warning when none are open', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));

    expect(
      screen.queryByText(/Open terminals will be closed/),
    ).not.toBeInTheDocument();
  });
});

function openTerminal(cardId: string, shellAlive: boolean): SessionSnapshot {
  return {
    cardId,
    sessionId: null,
    status: 'working',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    engine: 'terminal',
    terminal: { shellAlive, claudeRunning: false },
  };
}

describe('SettingsDialog open terminals', () => {
  beforeEach(() => {
    installElectronMock();
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
    useDocStore.setState({ doc: seededDoc() });
    useSessionStore.setState({
      sessions: {
        crd_a: openTerminal('crd_a', true),
        crd_b: openTerminal('crd_b', true),
        crd_idle_dead: openTerminal('crd_idle_dead', false),
      },
    });
  });

  it('shows how many terminals are open and closes the idle ones', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    expect(screen.getByText('2 terminals open')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Close idle terminals' }),
    );

    expect(window.electron.terminal.closeIdle).toHaveBeenCalledTimes(1);
  });

  it('warns that restarting the daemon closes open terminals', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Daemon' }));

    expect(
      screen.getByText(/Open terminals will be closed/),
    ).toBeInTheDocument();
  });
});
