import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useStickToBottom } from '@/lib/useStickToBottom';
import { installFakeScrollLayout } from '../testing/fakeScrollLayout';

/**
 * `installFakeScrollLayout` derives `scrollHeight` from the number of
 * element children, at 100px each, against a 100px viewport — so `rows`
 * here doubles as the container's height in hundreds of pixels, and the
 * bottom edge of an N-row feed sits at `scrollTop === N * 100`.
 */
function Feed({ rows, enabled }: { rows: number; enabled?: boolean }) {
  const ref = useStickToBottom<HTMLUListElement>(enabled);
  return (
    <ul ref={ref} data-testid="feed" className="overflow-y-auto">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>row {index + 1}</li>
      ))}
    </ul>
  );
}

const feed = () => screen.getByTestId('feed');

/** Plays the part of a user dragging the scrollbar to `offset`. */
function userScrollsTo(offset: number) {
  feed().scrollTop = offset;
  fireEvent.scroll(feed());
}

describe('useStickToBottom', () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installFakeScrollLayout();
  });

  afterEach(() => {
    uninstall();
  });

  it('pins a freshly mounted container to its bottom edge', () => {
    render(<Feed rows={3} />);

    expect(feed().scrollTop).toBe(300);
  });

  it('follows content that arrives while the container sits at the bottom', () => {
    const { rerender } = render(<Feed rows={3} />);

    rerender(<Feed rows={5} />);

    expect(feed().scrollTop).toBe(500);
  });

  it('leaves the offset alone once the user has scrolled away from the bottom', () => {
    const { rerender } = render(<Feed rows={3} />);

    userScrollsTo(0);
    rerender(<Feed rows={6} />);

    expect(feed().scrollTop).toBe(0);
  });

  it('resumes following once the user scrolls back to the bottom', () => {
    const { rerender } = render(<Feed rows={3} />);
    userScrollsTo(0);
    rerender(<Feed rows={6} />);

    // 6 rows against a 100px viewport puts the bottom edge at 500.
    userScrollsTo(500);
    rerender(<Feed rows={8} />);

    expect(feed().scrollTop).toBe(800);
  });

  it('never touches the offset while disabled', () => {
    const { rerender } = render(<Feed rows={3} enabled={false} />);

    rerender(<Feed rows={5} enabled={false} />);

    expect(feed().scrollTop).toBe(0);
  });
});
