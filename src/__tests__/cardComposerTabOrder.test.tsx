/**
 * Tab order in the New prompt dialog: Title -> Prompt -> Notes -> the rest,
 * and Shift+Tab walks it backwards without ever landing on the close button.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

async function tab(from: HTMLElement, shiftKey = false) {
  await act(async () => {
    fireEvent.keyDown(from, { key: 'Tab', shiftKey });
    await Promise.resolve();
  });
}

describe('CardComposerDialog tab order', () => {
  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
  });

  it('Tab/Shift+Tab move Title <-> Prompt <-> Notes', async () => {
    const doc = useDocStore.getState().doc!;
    render(
      <CardComposerDialog
        open
        onOpenChange={jest.fn()}
        boardId={doc.boards[0].id}
        listId={doc.boards[0].lists[0].id}
        cardId={null}
      />,
    );
    const title = screen.getByLabelText('Title');
    const prompt = screen.getByLabelText('Prompt');
    const notes = screen.getByLabelText('Notes');
    title.focus();
    await tab(title);
    expect(prompt).toHaveFocus();
    await tab(prompt, true);
    expect(title).toHaveFocus();
    await tab(title);
    await tab(prompt);
    expect(notes).toHaveFocus();
    await tab(notes, true);
    expect(prompt).toHaveFocus();
  });
});
