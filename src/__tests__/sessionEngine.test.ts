import fixture from './fixtures/kanban-v1.json';
import { parseDoc } from '../shared/schema';
import {
  resolveSessionEngine,
  terminalSupported,
} from '../shared/sessionEngine';

describe('resolveSessionEngine', () => {
  it('inherits the global engine when the card has no override', () => {
    expect(resolveSessionEngine(null, 'terminal', 'darwin')).toBe('terminal');
  });

  it('keeps a card override on a platform that supports terminals', () => {
    expect(resolveSessionEngine('sdk', 'terminal', 'linux')).toBe('sdk');
  });

  it('forces the built-in engine on Windows', () => {
    expect(resolveSessionEngine('terminal', 'terminal', 'win32')).toBe('sdk');
  });
});

describe('terminalSupported', () => {
  it('is false on Windows and true on macOS', () => {
    expect(terminalSupported('win32')).toBe(false);
    expect(terminalSupported('darwin')).toBe(true);
  });
});

describe('parseDoc sessionEngine', () => {
  it('defaults an omitted sessionEngine to null', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].sessionEngine).toBeNull();
  });

  it('falls back to null for an unrecognized sessionEngine', () => {
    const raw = JSON.parse(JSON.stringify(fixture)) as {
      boards: { lists: { cards: { sessionEngine?: string }[] }[] }[];
    };
    raw.boards[0].lists[0].cards[0].sessionEngine = 'bogus';
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].sessionEngine).toBeNull();
  });
});
