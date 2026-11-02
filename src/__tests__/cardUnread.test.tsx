import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import type { SessionSnapshot } from '@shared/daemonProtocol';
import { installElectronMock } from '../testUtils/electronMock';

jest.mock('@/lib/notificationSound', () => ({
  playTaskFinishedSound: jest.fn(),
  playNeedsInputSound: jest.fn(),
}));
jest.mock('@/lib/nativeNotification', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const snap = (cardId: string, status: SessionSnapshot['status']) =>
  ({
    cardId,
    sessionId: null,
    status,
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
  }) as SessionSnapshot;

describe('unread card outline', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {}, unread: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Unread me', prompt: 'p' });
  });

  const renderCard = () =>
    render(
      <DragDropContext onDragEnd={() => {}}>
        <Droppable droppableId={listId} type="CARD">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              <PromptCard
                boardId={boardId}
                listId={listId}
                cardId={cardId}
                index={0}
              />
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>,
    );

  const outer = () =>
    document.querySelector(`[data-rfd-draggable-id="${cardId}"]`)!;

  it('outlines a card after a live done transition and clears on open', () => {
    renderCard();
    expect(outer().className).not.toContain('emerald');
    act(() => {
      useSessionStore.getState().applySnapshot(snap(cardId, 'working'));
      useSessionStore.getState().applySnapshot(snap(cardId, 'done'));
    });
    expect(outer().className).toContain('border-emerald-500');
    act(() => {
      screen.getAllByText('Unread me')[0].click();
    });
    expect(outer().className).not.toContain('emerald');
  });
});
