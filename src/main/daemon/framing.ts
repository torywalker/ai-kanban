export function encodeFrame(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

/**
 * Returns a function you feed raw chunks into as they arrive; it buffers
 * partial lines across chunks and calls `onMessage` once per complete,
 * parsed JSON line. A line that fails to parse is dropped rather than
 * throwing — a partial write from a crashed peer should not take down the
 * reader.
 */
export function createFrameDecoder(
  onMessage: (obj: unknown) => void,
): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          // Drop malformed lines; see doc comment above.
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  };
}
