import fixture from './fixtures/kanban-v1.json';
import { parseDoc } from '../shared/schema';

/**
 * The v1 fixture with a `color` written onto its first card, so the color
 * cases exercise the same real document shape as every other parse test.
 */
function withCardColor(color: string): unknown {
  const doc = JSON.parse(JSON.stringify(fixture));
  doc.boards[0].lists[0].cards[0].color = color;
  return doc;
}

describe('parseDoc', () => {
  it('parses the v1 fixture', () => {
    const result = parseDoc(fixture);
    expect(result.ok).toBe(true);
  });

  it('defaults the omitted optional card fields', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    const card = result.doc.boards[0].lists[0].cards[0];
    expect(card.notes).toBe('');
    expect(card.link).toBe('');
    expect(card.variables).toEqual({});
    expect(card.copyCount).toBe(0);
    expect(card.lastCopiedAt).toBeNull();
  });

  it('defaults the new session fields on both cards and boards', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    const card = result.doc.boards[0].lists[0].cards[0];
    expect(card.sessionTool).toBeNull();
    expect(card.sessionRepo).toBeNull();
    expect(card.sessionId).toBeNull();
    expect(result.doc.boards[0].defaultRepo).toBeNull();
  });

  it('defaults omitted worktree fields to null', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    const card = result.doc.boards[0].lists[0].cards[0];
    expect(card.useWorktree).toBeNull();
    expect(card.sessionWorktree).toBeNull();
  });

  it('round-trips a written sessionWorktree object', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].lists[0].cards[0].sessionWorktree = {
      path: '/tmp/wt-crd_abc',
      branch: 'kanban/crd_abc',
      recordedTargetBranch: 'main',
    };
    raw.boards[0].lists[0].cards[0].useWorktree = true;
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].sessionWorktree).toEqual({
      path: '/tmp/wt-crd_abc',
      branch: 'kanban/crd_abc',
      recordedTargetBranch: 'main',
    });
    expect(result.doc.boards[0].lists[0].cards[0].useWorktree).toBe(true);
  });

  it('defaults an omitted card color to null', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].color).toBeNull();
  });

  it('defaults an omitted archived flag to false so older files stay visible', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].archived).toBe(false);
    expect(result.doc.boards[0].archived).toBe(false);
  });

  it('defaults an omitted scratchpad to an empty string', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].scratchpad).toBe('');
  });

  it('keeps a scratchpad that was saved on the board', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].scratchpad = 'remember this';
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].scratchpad).toBe('remember this');
  });

  it('defaults omitted card attachments to an empty array', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].attachments).toEqual([]);
  });

  it('keeps recognized attachments', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].lists[0].cards[0].attachments = [
      { id: 'att_aaaaaa', filename: 'shot.png', mimeType: 'image/png' },
    ];
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].attachments).toEqual([
      { id: 'att_aaaaaa', filename: 'shot.png', mimeType: 'image/png' },
    ]);
  });

  it('keeps an archived board archived', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].archived = true;
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].archived).toBe(true);
  });

  it('keeps an archived card archived', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].lists[0].cards[0].archived = true;
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].archived).toBe(true);
  });

  it('keeps a recognized card color', () => {
    const result = parseDoc(withCardColor('violet'));
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].color).toBe('violet');
  });

  it('falls back to null for a card color this build does not know', () => {
    // Forward compatibility: a file written by a future build that added an
    // eleventh color must still open, just without that card's tint.
    const result = parseDoc(withCardColor('chartreuse'));
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].color).toBeNull();
  });

  it('rejects a board whose lists array is missing', () => {
    const result = parseDoc({
      version: 1,
      tags: {},
      boards: [{ id: 'brd_x', name: 'Broken' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/lists/);
  });

  it('rejects a future version rather than downgrading it', () => {
    const result = parseDoc({ version: 2, tags: {}, boards: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/version/i);
  });
});
