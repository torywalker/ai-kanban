import type { Card } from '../shared/schema';
import {
  EMPTY_FILTER,
  cardMatches,
  isFilterActive,
  type FilterState,
} from '../renderer/domain/filter';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'crd_1',
    title: 'Untitled',
    prompt: '',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    notes: '',
    link: '',
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    priority: null,
    color: null,
    sessionTool: null,
    sessionRepo: null,
    sessionId: null,
    sessionModel: null,
    useWorktree: null,
    sessionWorktree: null,
    archived: false,
    attachments: [],
    ...overrides,
  };
}

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('is false when text is only whitespace and no tags', () => {
    expect(isFilterActive({ text: '   ', tags: [] })).toBe(false);
  });

  it('is true when text is non-empty', () => {
    expect(isFilterActive({ text: 'foo', tags: [] })).toBe(true);
  });

  it('is true when at least one tag is selected', () => {
    expect(isFilterActive({ text: '', tags: ['urgent'] })).toBe(true);
  });
});

describe('cardMatches', () => {
  it('matches everything against the empty filter', () => {
    const card = makeCard();
    expect(cardMatches(card, EMPTY_FILTER)).toBe(true);
  });

  it('matches text found in the title', () => {
    const card = makeCard({ title: 'Refactor the onboarding flow' });
    const filter: FilterState = { text: 'onboarding', tags: [] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('matches text buried in the middle of the prompt', () => {
    const card = makeCard({
      prompt: 'Some preamble. the secret phrase lives here. Some epilogue.',
    });
    const filter: FilterState = { text: 'secret phrase', tags: [] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('matches text found in notes', () => {
    const card = makeCard({ notes: 'remember to check the API quota' });
    const filter: FilterState = { text: 'quota', tags: [] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('matches text found in a tag name', () => {
    const card = makeCard({ tags: ['backend'] });
    const filter: FilterState = { text: 'back', tags: [] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('is case-insensitive', () => {
    const card = makeCard({ title: 'Refactor The Onboarding Flow' });
    const filter: FilterState = { text: 'ONBOARDING', tags: [] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('does not match unrelated text', () => {
    const card = makeCard({ title: 'Write release notes' });
    const filter: FilterState = { text: 'quarterly forecast', tags: [] };
    expect(cardMatches(card, filter)).toBe(false);
  });

  it('AND-s multiple tags: fails if any tag is missing', () => {
    const card = makeCard({ tags: ['backend'] });
    const filter: FilterState = { text: '', tags: ['backend', 'urgent'] };
    expect(cardMatches(card, filter)).toBe(false);
  });

  it('AND-s multiple tags: passes only if all tags are present', () => {
    const card = makeCard({ tags: ['backend', 'urgent', 'reviewed'] });
    const filter: FilterState = { text: '', tags: ['backend', 'urgent'] };
    expect(cardMatches(card, filter)).toBe(true);
  });

  it('combines tag and text filters with AND semantics', () => {
    const card = makeCard({
      title: 'Fix the login bug',
      tags: ['backend'],
    });
    expect(cardMatches(card, { text: 'login', tags: ['backend'] })).toBe(true);
    expect(cardMatches(card, { text: 'login', tags: ['frontend'] })).toBe(
      false,
    );
    expect(cardMatches(card, { text: 'signup', tags: ['backend'] })).toBe(
      false,
    );
  });
});
