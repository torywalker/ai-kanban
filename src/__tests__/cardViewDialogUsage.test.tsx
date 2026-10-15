/**
 * The card's own answer to "what did this cost me". Read from the usage
 * ledger over IPC rather than from the session snapshot, because it has to
 * be answerable for a card whose session this daemon never saw — after a
 * relaunch, or when no daemon is running at all.
 *
 * The refetch-on-settle behaviour is the part worth pinning down: cost is
 * only knowable at a turn's `result` message, so a card left open while the
 * agent works must pick up the new figure when the turn ends, without the
 * user closing and reopening the dialog.
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';
import { EMPTY_USAGE_TOTALS, type UsageTotals } from '../shared/usage';
import type { SessionStatus } from '../shared/daemonProtocol';

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    ...EMPTY_USAGE_TOTALS,
    turns: 2,
    inputTokens: 1200,
    outputTokens: 450,
    cacheReadInputTokens: 84000,
    cacheCreationInputTokens: 6100,
    costUSD: 0.0312,
    lastRunAt: new Date().toISOString(),
    byModel: [
      {
        model: 'claude-opus-5',
        turns: 2,
        inputTokens: 1200,
        outputTokens: 450,
        cacheReadInputTokens: 84000,
        cacheCreationInputTokens: 6100,
        costUSD: 0.0312,
      },
    ],
    ...overrides,
  };
}

describe('CardViewDialog usage', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  const cardTotals = () => window.electron.usage.cardTotals as jest.Mock;

  const setSnapshot = (status: SessionStatus) =>
    act(() => {
      useSessionStore.getState().applySnapshot({
        cardId,
        sessionId: 'sess_1',
        status,
        checklist: [],
        messages: [],
        pendingApproval: null,
        lastError: null,
      });
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
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Runnable card',
      prompt: 'Fix the thing.',
      tags: ['urgent'],
    });
  });

  it('shows what the card has cost so far', async () => {
    cardTotals().mockResolvedValue(totals());
    renderDialog();

    expect(await screen.findByText('$0.0312')).toBeInTheDocument();
    expect(screen.getByText(/2 turns/)).toBeInTheDocument();
  });

  it('asks the ledger for this card specifically', async () => {
    cardTotals().mockResolvedValue(totals());
    renderDialog();

    await waitFor(() => expect(cardTotals()).toHaveBeenCalledWith(cardId));
  });

  it('picks up the new cost when a turn finishes, without being reopened', async () => {
    cardTotals().mockResolvedValue(EMPTY_USAGE_TOTALS);
    setSnapshot('working');
    renderDialog();

    expect(await screen.findByText('$0.00')).toBeInTheDocument();

    // The turn's `result` message has landed: the daemon has appended the
    // row, and the status it flipped is the renderer's only signal that
    // there is something new to read.
    cardTotals().mockResolvedValue(totals());
    setSnapshot('done');

    expect(await screen.findByText('$0.0312')).toBeInTheDocument();
  });

  it('does not re-read the ledger on every tool call mid-turn', async () => {
    cardTotals().mockResolvedValue(EMPTY_USAGE_TOTALS);
    setSnapshot('working');
    renderDialog();

    await waitFor(() => expect(cardTotals()).toHaveBeenCalledTimes(1));

    // A tool approval pauses and resumes the same turn — no result message,
    // so no new usage to read.
    setSnapshot('waiting');
    setSnapshot('working');

    expect(cardTotals()).toHaveBeenCalledTimes(1);
  });

  it('always shows a usage figure, even on a card that has never run', async () => {
    cardTotals().mockResolvedValue(EMPTY_USAGE_TOTALS);
    renderDialog();

    expect(await screen.findByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText(/no runs yet/)).toBeInTheDocument();
  });

  it('shows tokens climbing while the agent is still working', async () => {
    cardTotals().mockResolvedValue(EMPTY_USAGE_TOTALS);
    renderDialog();
    await waitFor(() => expect(cardTotals()).toHaveBeenCalled());

    act(() => {
      useSessionStore.getState().applySnapshot({
        cardId,
        sessionId: 'sess_1',
        status: 'working',
        checklist: [],
        messages: [],
        pendingApproval: null,
        lastError: null,
        liveUsage: {
          msg_1: {
            inputTokens: 300,
            outputTokens: 40,
            cacheReadInputTokens: 12000,
            cacheCreationInputTokens: 0,
          },
        },
      });
    });

    // 300 + 40 + 12,000 tokens, climbing while the agent works.
    expect(screen.getByText(/12,340/)).toBeInTheDocument();
  });

  it('sits on the badge row with the priority, colour and tags', async () => {
    cardTotals().mockResolvedValue(totals());
    renderDialog();
    await screen.findByText('$0.0312');

    // `document`, not the render container: Radix portals the dialog out of
    // it, so querying the container finds nothing and any comparison between
    // two nothings passes for the wrong reason.
    const usage = document.querySelector('[data-slot="card-usage"]');
    const tag = screen.getByText('urgent');
    expect(usage).not.toBeNull();

    // Same row as the priority control and the tags, not a block of its own
    // beneath the prompt. Checked by containment rather than a shared
    // parent: tags are editable from this dialog now, and the TagPicker
    // that makes them so brings its own wrapping element, so the badge sits
    // nested inside the row instead of directly on it.
    const row = usage!.parentElement!;
    expect(row.contains(tag)).toBe(true);
    expect(row.contains(screen.getByRole('button', { name: 'Priority' }))).toBe(
      true,
    );
  });

  it('stays usable when the ledger cannot be read at all', async () => {
    cardTotals().mockRejectedValue(new Error('EACCES'));
    renderDialog();

    await waitFor(() => expect(cardTotals()).toHaveBeenCalled());
    // The card itself still renders, and usage degrades to a zero figure
    // rather than taking the dialog down with it.
    expect(screen.getByText('Runnable card')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });
});
