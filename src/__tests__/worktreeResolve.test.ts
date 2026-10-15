import {
  resolveUseWorktree,
  featureBranchFor,
  shipCommitMessage,
  truncateBranch,
} from '../shared/worktree';

it('inherits the global flag when the card is null', () => {
  expect(resolveUseWorktree(null, true)).toBe(true);
  expect(resolveUseWorktree(null, false)).toBe(false);
});

it('card true/false win', () => {
  expect(resolveUseWorktree(true, false)).toBe(true);
  expect(resolveUseWorktree(false, true)).toBe(false);
});

it('names the feature branch', () => {
  expect(featureBranchFor('crd_abc123')).toBe('kanban/crd_abc123');
});

it('rejects imported card ids that could escape the managed worktree path', () => {
  expect(() => featureBranchFor('../../outside')).toThrow(
    'Cannot create a worktree for an invalid card id.',
  );
  expect(() => featureBranchFor(`crd_${'a'.repeat(128)}`)).toThrow(
    'Cannot create a worktree for an invalid card id.',
  );
});

it('titles the Ship commit after the card and says where it came from', () => {
  const message = shipCommitMessage('  Add sound   notifications ', 'crd_abc');

  expect(message.split('\n')[0]).toBe('Add sound notifications');
  expect(message).toContain("Committed by Ship from this card's worktree.");
});

it('falls back to the card id when the title is blank', () => {
  expect(shipCommitMessage('   ', 'crd_abc').split('\n')[0]).toBe(
    'Card crd_abc',
  );
});

it('truncates long branch names with an ellipsis', () => {
  expect(truncateBranch('main')).toBe('main');
  expect(truncateBranch('a'.repeat(40), 32).endsWith('…')).toBe(true);
  expect(truncateBranch('a'.repeat(40), 32).length).toBe(32);
});
