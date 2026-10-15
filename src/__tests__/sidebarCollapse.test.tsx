import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useDocStore } from '@/store/docStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { installElectronMock } from '../testUtils/electronMock';

function twoBoardDoc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_alpha',
        name: 'Alpha',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
      {
        id: 'brd_beta',
        name: 'Beta',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
    ],
  };
}

describe('Sidebar collapse', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ sidebarCollapsed: false });
  });

  it('shows the board list and a right-aligned collapse button when expanded', () => {
    render(<Sidebar />);

    expect(screen.getByText('Boards')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeInTheDocument();
  });

  it('collapsing hides the board list, shows an expand button, and persists the choice', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(useDocStore.getState().sidebarCollapsed).toBe(true);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      sidebarCollapsed: true,
    });
    expect(screen.queryByText('Boards')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeInTheDocument();
  });

  it('expanding from the collapsed rail restores the full sidebar and persists the choice', () => {
    useDocStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(useDocStore.getState().sidebarCollapsed).toBe(false);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      sidebarCollapsed: false,
    });
    expect(screen.getByText('Boards')).toBeInTheDocument();
  });

  it('lists every board as a switchable button in the collapsed rail, marking the active one', () => {
    useDocStore.setState({
      sidebarCollapsed: true,
      doc: twoBoardDoc(),
      activeBoardId: 'brd_alpha',
    });
    render(<Sidebar />);

    const alpha = screen.getByRole('button', {
      name: 'Switch to board: Alpha',
    });
    const beta = screen.getByRole('button', {
      name: 'Switch to board: Beta',
    });
    expect(alpha).toHaveAttribute('aria-pressed', 'true');
    expect(beta).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a board button in the collapsed rail switches the active board without expanding', () => {
    useDocStore.setState({
      sidebarCollapsed: true,
      doc: twoBoardDoc(),
      activeBoardId: 'brd_alpha',
    });
    render(<Sidebar />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to board: Beta' }),
    );

    expect(useDocStore.getState().activeBoardId).toBe('brd_beta');
    expect(useDocStore.getState().sidebarCollapsed).toBe(true);
  });

  it('shows the whole emoji for a board name starting with one, not a broken half-glyph', () => {
    // Regression: 🧠 (U+1F9E0) and 🤖 (U+1F916) are outside the Basic
    // Multilingual Plane, so JS strings store them as UTF-16 surrogate
    // pairs. `.charAt(0)` grabs only the first code unit -- an unpaired
    // surrogate that renders as a broken/replacement-character glyph
    // (what looked like a stray "question mark icon" in the rail).
    useDocStore.setState({
      sidebarCollapsed: true,
      doc: {
        version: CURRENT_VERSION,
        tags: {},
        boards: [
          {
            id: 'brd_brain',
            name: '🧠 Ideas',
            defaultRepo: null,
            archived: false,
            scratchpad: '',
            lists: [],
          },
          {
            id: 'brd_robot',
            name: '🤖 Automation',
            defaultRepo: null,
            archived: false,
            scratchpad: '',
            lists: [],
          },
        ],
      },
      activeBoardId: 'brd_brain',
    });
    render(<Sidebar />);

    expect(
      screen.getByRole('button', { name: 'Switch to board: 🧠 Ideas' }),
    ).toHaveTextContent('🧠');
    expect(
      screen.getByRole('button', { name: 'Switch to board: 🤖 Automation' }),
    ).toHaveTextContent('🤖');
  });

  it('the collapsed rail has a Settings button that opens the settings dialog', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen.getByRole('heading', { name: 'Settings' }),
    ).toBeInTheDocument();
  });
});
