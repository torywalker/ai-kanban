import { formatCommentTime } from '@/components/card/CommentItem';

describe('formatCommentTime', () => {
  const now = new Date(2026, 10, 5, 15, 0); // local Nov 5, 2026 3:00 PM
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { timeStyle: 'short' });

  it('says Today with the time for a comment from the same calendar day', () => {
    const earlier = new Date(2026, 10, 5, 0, 5);
    expect(formatCommentTime(earlier.toISOString(), now)).toBe(
      `Today, ${time(earlier)}`,
    );
  });

  it('keeps the full date for yesterday, even a few hours ago', () => {
    const lateLastNight = new Date(2026, 10, 4, 23, 30);
    expect(formatCommentTime(lateLastNight.toISOString(), now)).toBe(
      lateLastNight.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    );
  });
});
