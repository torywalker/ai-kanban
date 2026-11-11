import { relativeTime } from '@/lib/relativeTime';

describe('relativeTime', () => {
  const now = new Date('2026-11-04T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('says "just now" under a minute', () => {
    expect(relativeTime(ago(30_000))).toBe('just now');
  });

  it('counts minutes, hours and days', () => {
    expect(relativeTime(ago(5 * 60_000))).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000))).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000))).toBe('2d ago');
  });

  it('falls back to a calendar date after 30 days', () => {
    const old = ago(40 * 86_400_000);
    expect(relativeTime(old)).toBe(new Date(old).toLocaleDateString());
  });
});
