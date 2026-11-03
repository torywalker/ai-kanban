/**
 * The terminal panel is the card dialog's xterm surface: it attaches to
 * the daemon's pty, replays the ring buffer before accepting live output,
 * and sends keystrokes and the fitted size back.
 */
import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { TerminalPanel } from '@/components/card/TerminalPanel';
import { FitAddon } from '../../.erb/mocks/xterm-addon-fit';
import { Terminal } from '../../.erb/mocks/xterm';

function installResizeObserver(): void {
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: () => {},
    unobserve: () => {},
    disconnect: () => {},
  }));
}

function installTerminalBridge() {
  let onData: (cardId: string, data: string) => void = () => {};
  let onReplay: (cardId: string, data: string) => void = () => {};
  const terminal = {
    start: jest.fn().mockResolvedValue(undefined),
    input: jest.fn(),
    resize: jest.fn(),
    interrupt: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    attach: jest.fn().mockResolvedValue(undefined),
    closeIdle: jest.fn().mockResolvedValue(undefined),
    onData: jest.fn((cb: (cardId: string, data: string) => void) => {
      onData = cb;
      return () => {};
    }),
    onReplay: jest.fn((cb: (cardId: string, data: string) => void) => {
      onReplay = cb;
      return () => {};
    }),
  };
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: { terminal, platform: 'darwin' },
  });
  return {
    terminal,
    emitData: (cardId: string, data: string) => onData(cardId, data),
    emitReplay: (cardId: string, data: string) => onReplay(cardId, data),
  };
}

beforeEach(() => {
  Terminal.instances = [];
  FitAddon.instances = [];
  installResizeObserver();
  document.documentElement.classList.remove('dark');
});

describe('TerminalPanel', () => {
  it('attaches on mount and disposes the terminal on unmount', () => {
    const { terminal } = installTerminalBridge();
    const { unmount } = render(<TerminalPanel cardId="crd_1" />);

    expect(terminal.attach).toHaveBeenCalledWith('crd_1');
    const term = Terminal.instances[0];
    expect(term.options.fontSize).toBe(15);
    expect(term.options.fontFamily).toEqual(
      expect.stringContaining('monospace'),
    );

    unmount();
    expect(term.dispose).toHaveBeenCalled();
  });

  it('drops output until the replay, then writes that card’s later output', () => {
    const { emitData, emitReplay } = installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    const term = Terminal.instances[0];

    emitData('crd_1', 'early');
    expect(term.write).not.toHaveBeenCalled();

    emitReplay('crd_1', 'abc');
    expect(term.reset.mock.invocationCallOrder[0]).toBeLessThan(
      term.write.mock.invocationCallOrder[0],
    );
    expect(term.write).toHaveBeenCalledWith('abc');

    emitData('crd_1', 'd');
    expect(term.write).toHaveBeenCalledWith('d');

    emitData('crd_2', 'nope');
    expect(term.write).not.toHaveBeenCalledWith('nope');
  });

  it('nudges the pty size after a replay so Claude repaints its UI', () => {
    jest.useFakeTimers();
    try {
      const { terminal, emitReplay } = installTerminalBridge();
      render(<TerminalPanel cardId="crd_1" />);
      const term = Terminal.instances[0];

      emitReplay('crd_1', '');
      jest.runAllTimers();
      terminal.resize.mockClear();

      emitReplay('crd_1', 'history');
      expect(terminal.resize).toHaveBeenLastCalledWith(
        'crd_1',
        term.cols - 1,
        term.rows,
      );

      jest.runAllTimers();
      expect(terminal.resize).toHaveBeenLastCalledWith(
        'crd_1',
        term.cols,
        term.rows,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('writes data that follows an empty replay and resets on the next one', () => {
    const { emitData, emitReplay } = installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    const term = Terminal.instances[0];

    emitReplay('crd_1', '');
    emitData('crd_1', 'hi');
    expect(term.write).toHaveBeenCalledWith('hi');

    emitReplay('crd_1', 'again');
    expect(term.reset).toHaveBeenCalledTimes(2);
    expect(term.reset.mock.invocationCallOrder[1]).toBeLessThan(
      term.write.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(term.write).toHaveBeenLastCalledWith('again');
  });

  it('sends keystrokes to the card’s pty', () => {
    const { terminal } = installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    const term = Terminal.instances[0];
    const onData = term.onData.mock.calls[0][0] as (data: string) => void;

    onData('x');

    expect(terminal.input).toHaveBeenCalledWith('crd_1', 'x');
  });

  it('drops keystrokes while input is suspended', () => {
    const { terminal } = installTerminalBridge();
    const { rerender } = render(
      <TerminalPanel cardId="crd_1" acceptInput={false} />,
    );
    const term = Terminal.instances[0];
    const onData = term.onData.mock.calls[0][0] as (data: string) => void;

    onData('x');
    expect(terminal.input).not.toHaveBeenCalled();

    rerender(<TerminalPanel cardId="crd_1" acceptInput />);
    onData('y');
    expect(terminal.input).toHaveBeenCalledWith('crd_1', 'y');
  });

  it('refits once the host has a height the first fit missed', () => {
    const queued: Array<(time: number) => void> = [];
    const raf = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        queued.push(cb);
        return queued.length;
      });
    const height = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 400;
      },
    });
    try {
      const { terminal } = installTerminalBridge();
      render(<TerminalPanel cardId="crd_1" />);
      const term = Terminal.instances[0];
      const fit = FitAddon.instances[0];
      fit.fit.mockImplementation(() => {
        term.rows = 42;
        term.cols = 130;
      });

      act(() => {
        for (let i = 0; i < 10 && queued.length > 0; i += 1) {
          queued.splice(0).forEach((cb) => cb(0));
        }
      });

      expect(terminal.resize).toHaveBeenLastCalledWith('crd_1', 130, 42);
    } finally {
      raf.mockRestore();
      if (height) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      } else {
        // The getter lives on Element.prototype; drop our override.
        delete (HTMLElement.prototype as { clientHeight?: number })
          .clientHeight;
      }
    }
  });

  it('resizes the pty to the fitted terminal', () => {
    const { terminal } = installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    const term = Terminal.instances[0];
    const fit = FitAddon.instances[0];

    expect(fit.fit).toHaveBeenCalled();
    expect(fit.fit.mock.invocationCallOrder[0]).toBeLessThan(
      terminal.resize.mock.invocationCallOrder[0],
    );
    expect(terminal.resize).toHaveBeenCalledWith('crd_1', term.cols, term.rows);
  });

  it('picks the theme from the document dark class', () => {
    installTerminalBridge();
    const { unmount } = render(<TerminalPanel cardId="crd_1" />);
    const light = Terminal.instances[0].options.theme?.background;
    unmount();

    document.documentElement.classList.add('dark');
    Terminal.instances = [];
    render(<TerminalPanel cardId="crd_1" />);

    expect(Terminal.instances[0].options.theme?.background).not.toBe(light);
  });

  it('with captureEscape false, Escape is not swallowed', () => {
    installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" captureEscape={false} />);
    const handler = Terminal.instances[0].keyHandler!;
    expect(handler(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
  });

  it('swallows Escape by default', () => {
    installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    const handler = Terminal.instances[0].keyHandler!;
    expect(handler(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(
      false,
    );
  });

  it('autoFocus focuses the terminal', () => {
    installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" autoFocus />);
    expect(Terminal.instances[0].focus).toHaveBeenCalled();
  });

  it('does not focus the terminal by default', () => {
    installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    expect(Terminal.instances[0].focus).not.toHaveBeenCalled();
  });

  it('an empty replay still sends the current size', () => {
    const { terminal, emitReplay } = installTerminalBridge();
    render(<TerminalPanel cardId="crd_1" />);
    terminal.resize.mockClear();

    emitReplay('crd_1', '');

    expect(terminal.resize).toHaveBeenCalledWith('crd_1', 80, 24);
  });
});
