import { act, render, screen } from '@testing-library/react';
import { SessionStatusBadge } from '../renderer/components/card/SessionStatusBadge';
import { useSessionStore } from '../renderer/store/sessionStore';
import type { SessionSnapshot, TerminalState } from '../shared/daemonProtocol';

function show(terminal: TerminalState | undefined) {
  const snapshot = {
    cardId: 'c1',
    sessionId: 's1',
    status: 'done',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    terminal,
  } as SessionSnapshot;
  act(() => {
    useSessionStore.setState({ sessions: { c1: snapshot } });
  });
  render(<SessionStatusBadge cardId="c1" />);
}

describe('SessionStatusBadge', () => {
  it('keeps the check while the Claude CLI is connected', () => {
    show({ shellAlive: true, claudeRunning: true });
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
  });

  it('shows the disconnected icon once the Claude CLI has closed', () => {
    show({ shellAlive: true, claudeRunning: false });
    expect(screen.getByRole('img', { name: /Disconnected/ })).toBeTruthy();
  });

  it('keeps the check for a non-terminal session', () => {
    show(undefined);
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
  });
});
