import {
  applySlashSnippet,
  expandSlashAtCaret,
  normalizeTrigger,
  sanitizeSlashSnippets,
  slashQueryAtCaret,
  type SlashSnippet,
} from '../shared/slashSnippets';

const grill: SlashSnippet = {
  id: 'snp_grill',
  trigger: 'grill-me',
  expansion: 'Use the /grill-me skill to ask questions',
};

describe('slash snippet expansion', () => {
  it('finds an empty query as soon as a slash is typed', () => {
    expect(slashQueryAtCaret('Start /', 'Start /'.length)).toEqual({
      start: 6,
      end: 7,
      query: '',
    });
  });

  it('finds a partial command immediately before the caret', () => {
    expect(slashQueryAtCaret('Start /gri later', 'Start /gri'.length)).toEqual({
      start: 6,
      end: 10,
      query: 'gri',
    });
  });

  it('replaces a partial command selected from suggestions', () => {
    const text = 'Start /gri later';
    const query = slashQueryAtCaret(text, 'Start /gri'.length);
    if (!query) throw new Error('expected slash query');
    expect(applySlashSnippet(text, query, grill)).toEqual({
      text: 'Start Use the /grill-me skill to ask questions later',
      caret: 'Start Use the /grill-me skill to ask questions'.length,
    });
  });

  it('expands a finished command on the keystroke that completes it', () => {
    const result = expandSlashAtCaret('/grill-me', '/grill-me'.length, [grill]);
    expect(result).toEqual({
      text: 'Use the /grill-me skill to ask questions',
      caret: 'Use the /grill-me skill to ask questions'.length,
    });
  });

  it('leaves an unfinished command alone', () => {
    expect(expandSlashAtCaret('/grill', '/grill'.length, [grill])).toBeNull();
  });

  it('waits to expand a shorter command that begins a longer one', () => {
    const snippets = [
      grill,
      { id: 'snp_short', trigger: 'grill', expansion: 'Ask hard questions' },
    ];
    expect(expandSlashAtCaret('/grill', '/grill'.length, snippets)).toBeNull();
    expect(expandSlashAtCaret('/grill ', '/grill '.length, snippets)).toEqual({
      text: 'Ask hard questions ',
      caret: 'Ask hard questions '.length,
    });
  });

  it('expands in the middle of a prompt and keeps the surrounding text', () => {
    const text = 'Please /grill-me now';
    const caret = 'Please /grill-me'.length;
    expect(expandSlashAtCaret(text, caret, [grill])).toEqual({
      text: 'Please Use the /grill-me skill to ask questions now',
      caret: 'Please Use the /grill-me skill to ask questions'.length,
    });
  });

  it('ignores a slash that is part of a url', () => {
    const text = 'see https://example.com';
    expect(expandSlashAtCaret(text, text.length, [grill])).toBeNull();
  });

  it('normalizes a typed command and rejects spaces', () => {
    expect(normalizeTrigger(' /Grill-Me ')).toBe('grill-me');
    expect(normalizeTrigger('grill me')).toBeNull();
  });

  it('drops malformed saved commands', () => {
    expect(
      sanitizeSlashSnippets([
        grill,
        { id: 'snp_bad', trigger: 'has space', expansion: 'nope' },
        { trigger: 'missing-id', expansion: 'nope' },
      ]),
    ).toEqual([grill]);
  });
});
