import confetti from 'canvas-confetti';
import {
  confettiOriginFor,
  fireConfetti,
  fireConfettiOnCard,
  isCelebrationListName,
} from '../renderer/lib/confetti';

jest.mock('canvas-confetti', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const confettiMock = confetti as jest.MockedFunction<typeof confetti>;

/** Spelled structurally because `FrameRequestCallback` is not a lint global. */
type Frame = Parameters<typeof window.requestAnimationFrame>[0];

/** `fireConfetti` divides by these, and jsdom's defaults are not round. */
function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
  });
}

describe('isCelebrationListName', () => {
  it.each(['Done', 'done', 'DONE', 'Finished', 'Completed', 'completed'])(
    'matches a list literally named "%s"',
    (name) => {
      expect(isCelebrationListName(name)).toBe(true);
    },
  );

  it.each(['To Do', 'In Progress', 'Doing', 'Blocked'])(
    'does not match an unrelated list name "%s"',
    (name) => {
      expect(isCelebrationListName(name)).toBe(false);
    },
  );

  it.each(['Undone', 'Unfinished'])(
    'does not match "%s" as a substring of a whole word',
    (name) => {
      expect(isCelebrationListName(name)).toBe(false);
    },
  );

  it('matches the word anywhere within a longer list name', () => {
    expect(isCelebrationListName('✅ Done')).toBe(true);
    expect(isCelebrationListName('Completed this sprint')).toBe(true);
  });
});

describe('confettiOriginFor', () => {
  const viewport = { width: 1000, height: 800 };

  it('aims at the center of the rect as a fraction of the window', () => {
    expect(
      confettiOriginFor(
        { left: 200, top: 300, width: 200, height: 100 },
        viewport,
      ),
    ).toEqual({ x: 0.3, y: 0.4375 });
  });

  it('clamps a card scrolled past the edge of the window back onto it', () => {
    expect(
      confettiOriginFor(
        { left: 980, top: -200, width: 200, height: 100 },
        viewport,
      ),
    ).toEqual({ x: 1, y: 0 });
  });

  it('falls back to the screen for an element with no layout', () => {
    expect(
      confettiOriginFor({ left: 0, top: 0, width: 0, height: 0 }, viewport),
    ).toEqual({ x: 0.5, y: 0.6 });
  });

  it('falls back to the screen for a window with no size', () => {
    expect(
      confettiOriginFor(
        { left: 10, top: 10, width: 50, height: 50 },
        { width: 0, height: 0 },
      ),
    ).toEqual({ x: 0.5, y: 0.6 });
  });
});

describe('fireConfetti', () => {
  afterEach(() => {
    confettiMock.mockReset();
  });

  it('fires from the screen when there is nothing to aim at', () => {
    fireConfetti();
    expect(confettiMock).toHaveBeenCalledTimes(1);
    expect(confettiMock.mock.calls[0][0]).toMatchObject({
      origin: { x: 0.5, y: 0.6 },
    });
  });

  it('spreads the full circle, so the burst expands rather than fountains', () => {
    fireConfetti();
    expect(confettiMock.mock.calls[0][0]).toMatchObject({ spread: 360 });
  });

  it('fires from the center of the element it is given', () => {
    const card = document.createElement('div');
    // jsdom lays nothing out, so the rect has to be stated outright.
    card.getBoundingClientRect = () =>
      ({ left: 100, top: 200, width: 300, height: 200 }) as DOMRect;
    setWindowSize(1000, 1000);

    fireConfetti(card);

    expect(confettiMock.mock.calls[0][0]).toMatchObject({
      origin: { x: 0.25, y: 0.3 },
    });
  });

  it('never throws when the underlying library throws', () => {
    confettiMock.mockImplementation(() => {
      throw new Error('canvas unavailable');
    });

    expect(() => fireConfetti()).not.toThrow();
  });
});

describe('fireConfettiOnCard', () => {
  afterEach(() => {
    confettiMock.mockReset();
    document.body.innerHTML = '';
  });

  it('waits a frame, then fires over that card rather than the screen', () => {
    const card = document.createElement('div');
    card.setAttribute('data-rfd-draggable-id', 'crd_abc123');
    card.getBoundingClientRect = () =>
      ({ left: 400, top: 0, width: 200, height: 100 }) as DOMRect;
    document.body.appendChild(card);
    setWindowSize(1000, 1000);

    const frames: Frame[] = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: Frame) => {
        frames.push(callback);
        return frames.length;
      });

    fireConfettiOnCard('crd_abc123');
    // The board has not re-rendered the card into its new column yet, so
    // nothing may have been measured at this point.
    expect(confettiMock).not.toHaveBeenCalled();

    frames.forEach((frame) => frame(0));

    expect(confettiMock.mock.calls[0][0]).toMatchObject({
      origin: { x: 0.5, y: 0.05 },
    });
    jest.mocked(window.requestAnimationFrame).mockRestore();
  });

  it('falls back to the screen when the card is no longer on the board', () => {
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: Frame) => {
        callback(0);
        return 1;
      });

    fireConfettiOnCard('crd_gone00');

    expect(confettiMock.mock.calls[0][0]).toMatchObject({
      origin: { x: 0.5, y: 0.6 },
    });
    jest.mocked(window.requestAnimationFrame).mockRestore();
  });
});
