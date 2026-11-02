export type SessionEngine = 'sdk' | 'terminal';

/** Windows has no terminal sessions yet; every other platform does. */
export function terminalSupported(platform: string): boolean {
  return platform !== 'win32';
}

/**
 * A card's own engine wins, unless this platform cannot run a terminal —
 * then the built-in engine is the only one that can actually start.
 */
export function resolveSessionEngine(
  card: SessionEngine | null,
  global: SessionEngine,
  platform: string,
): SessionEngine {
  if (!terminalSupported(platform)) return 'sdk';
  return card ?? global;
}
