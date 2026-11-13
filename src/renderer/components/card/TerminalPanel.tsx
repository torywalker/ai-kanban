import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal, type ITheme } from '@xterm/xterm';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import '@xterm/xterm/css/xterm.css';

const FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/** How long the pty stays one column narrow so Claude sees a resize. */
const REDRAW_NUDGE_MS = 80;

/**
 * Match highlights. xterm keeps the text's own color, so the backgrounds
 * are muted enough to read it against: dark amber on the dark theme, pale
 * amber on the light one. Alpha isn't supported, only #RRGGBB.
 */
function searchOptions() {
  const dark = document.documentElement.classList.contains('dark');
  return {
    decorations: {
      matchBackground: dark ? '#713f12' : '#fde68a',
      matchBorder: dark ? '#a16207' : '#facc15',
      matchOverviewRuler: '#facc15',
      activeMatchBackground: dark ? '#9a3412' : '#fdba74',
      activeMatchBorder: '#f97316',
      activeMatchColorOverviewRuler: '#f97316',
    },
  };
}

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
  autoFocus = false,
}: {
  cardId: string;
  /** False while Ship is running, so a keystroke can't edit the worktree. */
  // eslint-disable-next-line react/require-default-props
  acceptInput?: boolean;
  /** Focuses the terminal once it has mounted. */
  // eslint-disable-next-line react/require-default-props
  autoFocus?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const acceptInputRef = useRef(acceptInput);
  acceptInputRef.current = acceptInput;
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  const find = (backwards: boolean, text = query) => {
    const addon = searchRef.current;
    if (!addon) return;
    if (text === '') {
      addon.clearDecorations();
      return;
    }
    if (backwards) addon.findPrevious(text, searchOptions());
    else addon.findNext(text, searchOptions());
  };

  const closeSearch = () => {
    searchRef.current?.clearDecorations();
    setSearchOpen(false);
    termRef.current?.focus();
  };

  useEffect(() => {
    const host = hostRef.current;
    const bridge = window.electron?.terminal;
    if (!host || !bridge) return undefined;

    const term = new Terminal({
      fontSize: 15,
      // Search match highlights use xterm's decoration API.
      allowProposedApi: true,
      fontFamily: FONT_FAMILY,
      theme: themeForDocument(),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.open(host);
    term.loadAddon(fit);
    term.loadAddon(search);
    termRef.current = term;
    searchRef.current = search;
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
      // A fresh shell has nothing to repaint, but it still needs the real
      // size: the first fit's resize reached the daemon before the shell
      // existed, and a respawn restarts at 80x24.
      if (data === '') {
        bridge.resize(cardId, term.cols, term.rows);
        return;
      }
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
    // Escape goes to the pty (Claude's interrupt, vim, fzf). The dialogs
    // that host this panel ignore an Escape that starts inside it.
    // Cmd+Left/Right jump to line start/end (Ctrl+A / Ctrl+E), and
    // Shift+Enter inserts a newline like Option+Enter (ESC + CR) instead of
    // submitting.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return false;
      }
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
      termRef.current = null;
      searchRef.current = null;
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
      {searchOpen && (
        // data-terminal-host keeps Escape here from closing the host dialog.
        <div
          data-terminal-host=""
          className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
        >
          <Input
            ref={searchInputRef}
            value={query}
            placeholder="Find"
            aria-label="Find in terminal"
            className="h-7 w-48"
            onChange={(e) => {
              setQuery(e.target.value);
              find(false, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                find(e.shiftKey);
              }
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Previous match"
            onClick={() => find(true)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Next match"
            onClick={() => find(false)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Close find"
            onClick={closeSearch}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
