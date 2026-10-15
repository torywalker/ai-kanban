/**
 * The move dialog is mounted (closed) on every card. Its list selector used
 * to allocate a fresh `{ id, name }` object per list on every store read.
 * `useSyncExternalStore` treats that as a new snapshot and re-renders until
 * React aborts with "Maximum update depth exceeded" — which is what loading
 * the board did as soon as a second board existed.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MoveCardToBoardDialog } from '@/components/card/MoveCardToBoardDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('MoveCardToBoardDialog', () => {
  let fromBoardId: string;
  let fromListId: string;

  beforeEach(async () => {
    installElectronMock();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const home = useDocStore.getState().doc!.boards[0];
    fromBoardId = home.id;
    fromListId = home.lists[0].id;
    useDocStore.getState().addBoard('Other');
    useDocStore.getState().setActiveBoard(fromBoardId);
  });

  const renderDialog = (open: boolean) =>
    render(
      <MoveCardToBoardDialog
        open={open}
        onOpenChange={() => {}}
        cardTitle="A prompt"
        cardId="crd_1"
        fromBoardId={fromBoardId}
        fromListId={fromListId}
      />,
    );

  it('stays mounted while closed without re-rendering forever', () => {
    renderDialog(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists the other board when opened', () => {
    renderDialog(true);
    expect(
      screen.getByRole('dialog', { name: 'Move card to board' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });
});
