import { extractVariables, substitute } from '../renderer/domain/variables';

describe('extractVariables', () => {
  it('finds names in first-appearance order without duplicates', () => {
    expect(
      extractVariables('Review {{file}} for {{concern}}, then {{file}} again.'),
    ).toEqual(['file', 'concern']);
  });

  it('tolerates internal whitespace', () => {
    expect(extractVariables('a {{ file }} b')).toEqual(['file']);
  });

  it('returns an empty array when there are none', () => {
    expect(extractVariables('plain prompt')).toEqual([]);
  });
});

describe('substitute', () => {
  it('replaces every occurrence', () => {
    expect(substitute('{{a}} and {{a}}', { a: 'x' })).toBe('x and x');
  });

  it('leaves a placeholder intact when no value is supplied', () => {
    expect(substitute('{{a}} {{b}}', { a: 'x' })).toBe('x {{b}}');
  });

  it('does not treat a replacement value as a pattern', () => {
    // A value containing $& would be a capture reference in String.replace.
    expect(substitute('{{a}}', { a: '$&woops' })).toBe('$&woops');
  });

  it('does not leak inherited Object.prototype properties into the output', () => {
    // {{constructor}}, {{toString}}, etc. match the variable-name regex and
    // exist on every plain object via the prototype chain. Without an
    // own-property guard, `values[name]` would resolve to the inherited
    // function and splice something like
    // "function Object() { [native code] }" into copied text.
    expect(substitute('{{constructor}}', {})).toBe('{{constructor}}');
    expect(substitute('{{toString}}', {})).toBe('{{toString}}');
    expect(substitute('{{hasOwnProperty}}', {})).toBe('{{hasOwnProperty}}');
  });

  it('still substitutes an explicitly supplied own property with that same name', () => {
    expect(substitute('{{toString}}', { toString: 'value' })).toBe('value');
  });
});
