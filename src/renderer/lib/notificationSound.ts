import { useDocStore } from '@/store/docStore';

interface ToneStep {
  frequency: number;
  duration: number;
  delay: number;
}

/**
 * Generates chimes on the fly with the Web Audio API rather than shipping
 * audio assets — no webpack loader rule / `assets.d.ts` module declaration
 * needed for `.mp3`/`.wav`, and no licensing to track.
 *
 * Deliberately swallows every failure (`AudioContext` missing, blocked by an
 * autoplay policy, etc.) — a notification chime must never crash the app.
 */
function playTones(steps: ToneStep[]): void {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioContextCtor();
  let maxEndTime = 0;
  steps.forEach(({ frequency, duration, delay }) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const startAt = ctx.currentTime + delay;
    const endAt = startAt + duration;
    gain.gain.setValueAtTime(0.2, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.start(startAt);
    oscillator.stop(endAt);
    maxEndTime = Math.max(maxEndTime, endAt);
  });
  // Release the context once every tone in the chime has finished, so
  // repeated notifications don't accumulate open AudioContexts.
  setTimeout(() => void ctx.close(), (maxEndTime + 0.1) * 1000);
}

/** A short rising two-note chime: a card finished. */
export function playTaskFinishedSound(): void {
  if (!useDocStore.getState().soundEnabled) return;
  try {
    playTones([
      { frequency: 523.25, duration: 0.12, delay: 0 }, // C5
      { frequency: 783.99, duration: 0.18, delay: 0.12 }, // G5
    ]);
  } catch {
    // See playTones' doc comment: audio unavailable/blocked is not an error.
  }
}

/** A shorter same-pitch double-beep: a card needs your input. */
export function playNeedsInputSound(): void {
  if (!useDocStore.getState().soundEnabled) return;
  try {
    playTones([
      { frequency: 659.25, duration: 0.09, delay: 0 }, // E5
      { frequency: 659.25, duration: 0.09, delay: 0.14 }, // E5
    ]);
  } catch {
    // See playTones' doc comment: audio unavailable/blocked is not an error.
  }
}
