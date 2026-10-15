import confetti from 'canvas-confetti';

/**
 * Whole-word, case-insensitive match against the "done" family of column
 * names. Word boundaries keep a list literally named "Undone" (or
 * "Unfinished") from false-positiving on the substrings "done"/"finished".
 */
const CELEBRATION_WORDS = /\b(done|finished|completed)\b/i;

/** True when a list's name marks it as a "work is over" column. */
export function isCelebrationListName(name: string): boolean {
  return CELEBRATION_WORDS.test(name);
}

/**
 * Where a burst starts, in the fractional window coordinates
 * `canvas-confetti` takes: `{ x: 0, y: 0 }` is the top-left of the window
 * and `{ x: 1, y: 1 }` the bottom-right, because the library's default
 * canvas is stretched over the whole window.
 */
export interface ConfettiOrigin {
  x: number;
  y: number;
}

/** Used whenever there is nothing on screen to aim at. */
const SCREEN_CENTER: ConfettiOrigin = { x: 0.5, y: 0.6 };

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * The origin for a burst centered on `rect` within a window of `viewport`.
 *
 * Clamped to the window, since a card can sit partly outside it — columns
 * scroll independently — and an origin past the canvas edge would throw the
 * whole burst offscreen. A zero-sized rect means the element isn't laid out
 * (detached, or a test environment with no layout), which no amount of
 * arithmetic can turn into a position, so that falls back to the center.
 */
export function confettiOriginFor(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): ConfettiOrigin {
  if (viewport.width <= 0 || viewport.height <= 0) return SCREEN_CENTER;
  if (rect.width <= 0 && rect.height <= 0) return SCREEN_CENTER;
  return {
    x: clampFraction((rect.left + rect.width / 2) / viewport.width),
    y: clampFraction((rect.top + rect.height / 2) / viewport.height),
  };
}

/**
 * Fires a short confetti burst, centered on `target` when one is given and
 * on the screen otherwise.
 *
 * Wrapped in try/catch — like `notificationSound`'s tones, a celebratory
 * effect must never crash a card move if canvas/rAF is unavailable.
 */
export function fireConfetti(target?: Element | null): void {
  try {
    const origin = target
      ? confettiOriginFor(target.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : SCREEN_CENTER;
    confetti({
      particleCount: 120,
      // A full circle around the origin rather than the library's default
      // upward fan: the burst is anchored on the card now, so it should read
      // as the card itself popping, not as a fountain launched from behind
      // it. `angle` stops mattering at all once the spread is the whole 360°.
      spread: 360,
      // Slower than the default 45, which is tuned for a burst that has the
      // height of the window to travel. From the middle of a card, that
      // speed clears the board before the particles have time to fall.
      startVelocity: 28,
      origin,
    });
  } catch {
    // See doc comment above: confetti failing is not an error.
  }
}

/**
 * Celebrates over the card with `cardId`, wherever it has landed on screen.
 *
 * The frame's wait is the whole point. This runs from the drag library's
 * `onDragEnd`, and the store write that moves the card between columns only
 * reaches the DOM after that handler returns — measuring the card now would
 * read the position in the column it just left. A frame later it is sitting
 * where the user dropped it.
 */
export function fireConfettiOnCard(cardId: string): void {
  requestAnimationFrame(() => {
    // The drag library stamps this attribute onto every Draggable it
    // renders, and a drop reports the card's own id as its `draggableId`.
    // A miss is survivable: `fireConfetti` falls back to the screen.
    fireConfetti(document.querySelector(`[data-rfd-draggable-id="${cardId}"]`));
  });
}
