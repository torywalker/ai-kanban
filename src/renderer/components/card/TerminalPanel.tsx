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

export function TerminalPanel({ cardId }: { cardId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const bridge = window.electron?.terminal;
    if (!host || !bridge) return undefined;

    const term = new Terminal({
      fontSize: 13,
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
    const keyInput = term.onData((data) => {
      bridge.input(cardId, data);
    });

    const fitToHost = () => {
      fit.fit();
      bridge.resize(cardId, term.cols, term.rows);
    };
    fitToHost();
    const observer = new ResizeObserver(fitToHost);
    observer.observe(host);

    bridge.attach(cardId).catch(() => undefined);

    return () => {
      observer.disconnect();
      keyInput.dispose();
      unsubscribeData();
      unsubscribeReplay();
      term.dispose();
    };
  }, [cardId]);

  return (
    <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden" />
  );
}
