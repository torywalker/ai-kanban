/**
 * Archiving a board hides it from the sidebar and the board view without
 * removing it from the document. Right-click (and the ⋯ menu) archive it;
 * Settings → Boards lists every board and is where Unarchive lives.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { selectVisibleBoardIds } from '@/store/selectors';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';
import type { Settings } from '../shared/ipc';

const SETTINGS: Settings = {
  dataFilePath: '/tmp/kanban.json',
  recentFiles: [],
  activeBoardId: null,
  approvalMode: 'ask',
  defaultModel: null,
  useWorktrees: false,
  soundEnabled: true,
  sidebarCollapsed: false,
  slashSnippets: [],
};

function boardNamed(name: string) {
  return useDocStore.getState().doc!.boards.find((b) => b.name === name);
}

describe('archiving boards', () => {
  beforeAll(() => {
    // Radix context menus position themselves with DOMRect.fromRect, which
    // jsdom does not provide. A static method is all the menu calls.
    if (typeof window.DOMRect === 'undefined') {
      Object.defineProperty(window, 'DOMRect', {
        configurable: true,
        value: {
          fromRect(
            rect: {
              x?: number;
              y?: number;
              width?: number;
              height?: number;
            } = {},
          ) {
            const x = rect.x ?? 0;
            const y = rect.y ?? 0;
            const width = rect.width ?? 0;
            const height = rect.height ?? 0;
            return {
              x,
              y,
              width,
              height,
              top: y,
              left: x,
              bottom: y + height,
              right: x + width,
            };
          },
        },
      });
    }
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(async () => {
    installElectronMock();
    useDocStore.setState({ sidebarCollapsed: false });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    useDocStore.getState().addBoard('Other');
  });

  it('right-clicking a board archives it and leaves it in the document', () => {
    render(<Sidebar />);

    fireEvent.contextMenu(screen.getByText('Other'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive board' }));

    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.getByText('Prompts')).toBeInTheDocument();
    expect(boardNamed('Other')!.archived).toBe(true);
    expect(useDocStore.getState().activeBoardId).toBe(
      boardNamed('Prompts')!.id,
    );
    expect(selectVisibleBoardIds(useDocStore.getState())).toEqual([
      boardNamed('Prompts')!.id,
    ]);
  });

  it('archives from the collapsed rail as well', () => {
    useDocStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);

    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Switch to board: Other' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive board' }));

    expect(
      screen.queryByRole('button', { name: 'Switch to board: Other' }),
    ).not.toBeInTheDocument();
    expect(boardNamed('Other')!.archived).toBe(true);
  });

  it('archives from the board options menu as well', () => {
    render(<Sidebar />);

    const trigger = screen.getByRole('button', {
      name: 'Board options for Other',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive board' }));

    expect(boardNamed('Other')!.archived).toBe(true);
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('lists every board in Settings and unarchives from there', () => {
    const otherId = boardNamed('Other')!.id;
    useDocStore.getState().archiveBoard(otherId);

    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Boards');

    expect(screen.getByText('Prompts')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive Other' }));

    expect(boardNamed('Other')!.archived).toBe(false);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('puts an unarchived board back in the sidebar', () => {
    const otherId = boardNamed('Other')!.id;
    useDocStore.getState().archiveBoard(otherId);
    useDocStore.getState().unarchiveBoard(otherId);

    render(<Sidebar />);

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Prompts')).toBeInTheDocument();
  });

  it('opens a file onto the first board that is not archived', async () => {
    (window.electron.data.read as jest.Mock).mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        version: 1,
        tags: {},
        boards: [
          {
            id: 'brd_old',
            name: 'Old',
            archived: true,
            defaultRepo: null,
            lists: [],
          },
          {
            id: 'brd_new',
            name: 'New',
            archived: false,
            defaultRepo: null,
            lists: [],
          },
        ],
      }),
    });

    await useDocStore.getState().openAt('/tmp/existing.json');

    expect(useDocStore.getState().activeBoardId).toBe('brd_new');
    expect(useDocStore.getState().doc!.boards).toHaveLength(2);
  });

  it('does not restore a saved selection that points at an archived board', async () => {
    (window.electron.settings.read as jest.Mock).mockResolvedValue({
      ...SETTINGS,
      activeBoardId: 'brd_old',
    });
    (window.electron.data.read as jest.Mock).mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        version: 1,
        tags: {},
        boards: [
          {
            id: 'brd_old',
            name: 'Old',
            archived: true,
            defaultRepo: null,
            lists: [],
          },
          {
            id: 'brd_new',
            name: 'New',
            archived: false,
            defaultRepo: null,
            lists: [],
          },
        ],
      }),
    });

    await useDocStore.getState().bootstrap();

    expect(useDocStore.getState().activeBoardId).toBe('brd_new');
  });
});
