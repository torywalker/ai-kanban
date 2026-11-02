import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

const FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

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
}: {
  cardId: string;
  /** False while Ship is running, so a keystroke can't edit the worktree. */
  // eslint-disable-next-line react/require-default-props
  acceptInput?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const acceptInputRef = useRef(acceptInput);
  acceptInputRef.current = acceptInput;

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

    // Chunks that arrive before the replay would paint, then get wiped.
    let sawReplay = false;
    const unsubscribeData = bridge.onData((id, data) => {
      if (id !== cardId || !sawReplay) return;
      term.write(data);
    });
    const unsubscribeReplay = bridge.onReplay((id, data) => {
      if (id !== cardId) return;
      sawReplay = true;
      term.reset();
      term.write(data);
    });
    // Escape closes the dialog; the Stop button is the interrupt. Returning
    // false keeps xterm from sending it to the pty while the event still
    // bubbles up to the dialog's Escape handler.
    // Cmd+Left/Right jump to line start/end (Ctrl+A / Ctrl+E), and
    // Shift+Enter inserts a newline like Option+Enter (ESC + CR) instead of
    // submitting.
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Escape') return false;
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
    const refitUntilFilled = () => {
      if (cancelled || frames >= 8 || fillsHost()) return;
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
      observer.disconnect();
      keyInput.dispose();
      unsubscribeData();
      unsubscribeReplay();
      term.dispose();
    };
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
