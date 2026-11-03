import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/** How long the pty stays one column narrow so Claude sees a resize. */
const REDRAW_NUDGE_MS = 80;

function themeForDocument(): ITheme {
  const dark = document.documentElement.classList.contains('dark');
  if (dark) {
    return {
      background: '#1c1c1c',
      foreground: '#e4e4e7',
      cursor: '#e4e4e7',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#18181b',
    cursor: '#18181b',
  };
}

export function TerminalPanel({
  cardId,
  acceptInput = true,
  captureEscape = true,
  autoFocus = false,
}: {
  cardId: string;
  /** False while Ship is running, so a keystroke can't edit the worktree. */
  // eslint-disable-next-line react/require-default-props
  acceptInput?: boolean;
  /** True (the card dialog) keeps Escape from the pty. False lets it through. */
  // eslint-disable-next-line react/require-default-props
  captureEscape?: boolean;
  /** Focuses the terminal once it has mounted. */
  // eslint-disable-next-line react/require-default-props
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const acceptInputRef = useRef(acceptInput);
  acceptInputRef.current = acceptInput;
  const captureEscapeRef = useRef(captureEscape);
  captureEscapeRef.current = captureEscape;

  useEffect(() => {
    const host = hostRef.current;
    const bridge = window.electron?.terminal;
    if (!host || !bridge) return undefined;

    const term = new Terminal({
      fontSize: 15,
      fontFamily: FONT_FAMILY,
      theme: themeForDocument(),
    });
    const fit = new FitAddon();
    term.open(host);
    term.loadAddon(fit);
    if (autoFocus) term.focus();

    // Chunks that arrive before the replay would paint, then get wiped.
    // The replay itself waits for the fit to settle: Claude's bottom area
    // is drawn with cursor-relative moves, so replaying it into a grid that
    // is then resized leaves that area garbled until something repaints it.
    let sawReplay = false;
    let fitSettled = false;
    let pending: string | null = null;
    // The replay is raw output from the pty's whole life, including the
    // sizes it had before the first fit, so it can't recreate what a live
    // terminal showed. Nudging the pty's size makes Claude repaint its UI
    // for the real one, as tmux does on attach. A same-size resize sends
    // no SIGWINCH, so the width has to actually change.
    let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
    const paintReplay = (data: string) => {
      term.reset();
      term.write(data);
      if (data === '') return;
      clearTimeout(nudgeTimer);
      bridge.resize(cardId, Math.max(term.cols - 1, 1), term.rows);
      nudgeTimer = setTimeout(() => {
        bridge.resize(cardId, term.cols, term.rows);
      }, REDRAW_NUDGE_MS);
    };
    const unsubscribeData = bridge.onData((id, data) => {
      if (id !== cardId || !sawReplay) return;
      if (pending !== null) {
        pending += data;
        return;
      }
      term.write(data);
    });
    const unsubscribeReplay = bridge.onReplay((id, data) => {
      if (id !== cardId) return;
      sawReplay = true;
      if (!fitSettled) {
        pending = data;
        return;
      }
      paintReplay(data);
    });
    // Escape closes the dialog; the Stop button is the interrupt. Returning
    // false keeps xterm from sending it to the pty while the event still
    // bubbles up to the dialog's Escape handler.
    // Cmd+Left/Right jump to line start/end (Ctrl+A / Ctrl+E), and
    // Shift+Enter inserts a newline like Option+Enter (ESC + CR) instead of
    // submitting.
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Escape') return !captureEscapeRef.current;
      if (event.type !== 'keydown') return true;
      let seq: string | null = null;
      if (event.metaKey && !event.altKey && !event.ctrlKey) {
        if (event.key === 'ArrowLeft') seq = '\x01';
        else if (event.key === 'ArrowRight') seq = '\x05';
      } else if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.ctrlKey
      ) {
        seq = '\x1b\r';
      }
      if (seq === null) return true;
      event.preventDefault();
      if (acceptInputRef.current) bridge.input(cardId, seq);
      return false;
    });
    const keyInput = term.onData((data) => {
      if (!acceptInputRef.current) return;
      bridge.input(cardId, data);
    });

    // FitAddon reads the parent's computed CSS height, and it no-ops until
    // the renderer has measured a cell. The first call often lands before
    // either is ready and leaves the default 24 rows, which is the short
    // terminal on first open. Retry until the canvas fills the host.
    let lastCols = -1;
    let lastRows = -1;
    let frames = 0;
    let rafId = 0;
    let cancelled = false;
    const fitToHost = () => {
      fit.fit();
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      bridge.resize(cardId, term.cols, term.rows);
    };
    const fillsHost = () => {
      if (host.clientHeight === 0) return true;
      const termEl = host.querySelector('.xterm');
      if (!termEl) return false;
      return host.clientHeight - termEl.clientHeight < 8;
    };
    const settleFit = () => {
      fitSettled = true;
      if (pending === null) return;
      const data = pending;
      pending = null;
      paintReplay(data);
    };
    const refitUntilFilled = () => {
      if (cancelled) return;
      if (frames >= 8 || fillsHost()) {
        settleFit();
        return;
      }
      frames += 1;
      rafId = requestAnimationFrame(() => {
        fitToHost();
        refitUntilFilled();
      });
    };
    fitToHost();
    refitUntilFilled();
    const observer = new ResizeObserver(fitToHost);
    observer.observe(host);

    bridge.attach(cardId).catch(() => undefined);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(nudgeTimer);
      observer.disconnect();
      keyInput.dispose();
      unsubscribeData();
      unsubscribeReplay();
      term.dispose();
    };
    // autoFocus only matters at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  return (
    // The inner box is absolutely positioned so it has a definite height.
    // A flex child with no height of its own reports `auto`, and FitAddon
    // then can't size the pty to the space the dialog actually gave it.
    <div className="relative min-h-0 w-full flex-1">
      <div
        ref={hostRef}
        data-terminal-host=""
        className="absolute inset-0 overflow-hidden"
      />
    </div>
  );
}
