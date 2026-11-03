import { useDocStore } from '../renderer/store/docStore';
import { CURRENT_VERSION, type KanbanDoc } from '../shared/schema';

function seed(): void {
  const doc: KanbanDoc = {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_a',
        name: 'A',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        terminals: [],
        lists: [],
      },
    ],
  };
  useDocStore.setState({ doc });
}

const tabs = () => useDocStore.getState().doc!.boards[0].terminals;

describe('board terminals', () => {
  beforeEach(seed);

  it('addBoardTerminal names tabs Terminal 1, Terminal 2', () => {
    const { addBoardTerminal } = useDocStore.getState();
    addBoardTerminal('brd_a');
    addBoardTerminal('brd_a');
    expect(tabs().map((t) => t.name)).toEqual(['Terminal 1', 'Terminal 2']);
  });

  it('two rapid adds get distinct ids and names', () => {
    const { addBoardTerminal } = useDocStore.getState();
    const a = addBoardTerminal('brd_a');
    const b = addBoardTerminal('brd_a');
    expect(a).not.toBe(b);
    expect(tabs().map((t) => t.id)).toEqual([a, b]);
  });

  it('reuses the lowest free number after a removal', () => {
    const { addBoardTerminal, removeBoardTerminal } = useDocStore.getState();
    const first = addBoardTerminal('brd_a');
    addBoardTerminal('brd_a');
    removeBoardTerminal('brd_a', first);
    addBoardTerminal('brd_a');
    expect(tabs().map((t) => t.name)).toEqual(['Terminal 2', 'Terminal 1']);
  });

  it('rename trims and persists', () => {
    const { addBoardTerminal, renameBoardTerminal } = useDocStore.getState();
    const id = addBoardTerminal('brd_a');
    renameBoardTerminal('brd_a', id, '  build  ');
    expect(tabs()[0].name).toBe('build');
  });

  it('rename to blank or whitespace keeps the old name', () => {
    const { addBoardTerminal, renameBoardTerminal } = useDocStore.getState();
    const id = addBoardTerminal('brd_a');
    renameBoardTerminal('brd_a', id, '');
    renameBoardTerminal('brd_a', id, '   ');
    expect(tabs()[0].name).toBe('Terminal 1');
  });

  it('remove keeps the order of the remaining tabs', () => {
    const { addBoardTerminal, removeBoardTerminal } = useDocStore.getState();
    addBoardTerminal('brd_a');
    const mid = addBoardTerminal('brd_a');
    addBoardTerminal('brd_a');
    removeBoardTerminal('brd_a', mid);
    expect(tabs().map((t) => t.name)).toEqual(['Terminal 1', 'Terminal 3']);
  });

  it('removing the only tab leaves a fresh Terminal 1 with a different id', () => {
    const { addBoardTerminal, removeBoardTerminal } = useDocStore.getState();
    const id = addBoardTerminal('brd_a');
    removeBoardTerminal('brd_a', id);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].name).toBe('Terminal 1');
    expect(tabs()[0].id).not.toBe(id);
  });

  it('actions on an unknown board are no-ops', () => {
    const before = useDocStore.getState().doc;
    const s = useDocStore.getState();
    s.addBoardTerminal('nope');
    s.renameBoardTerminal('nope', 'x', 'y');
    s.removeBoardTerminal('nope', 'x');
    expect(useDocStore.getState().doc).toBe(before);
  });
});
