import { useDocStore } from '../renderer/store/docStore';
import {
  playTaskFinishedSound,
  playNeedsInputSound,
} from '../renderer/lib/notificationSound';

/**
 * jsdom ships no `AudioContext`, so every test installs its own fake one on
 * `window` and restores whatever was there afterward. Each call to
 * `createOscillator`/`createGain` returns a fresh stub object (pushed into
 * the returned arrays) so a test can inspect what each individual tone in a
 * chime was configured with, rather than only the last one.
 */
function installFakeAudioContext() {
  const oscillators: { frequency: { value: number }; start: jest.Mock; stop: jest.Mock; connect: jest.Mock }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator: jest.fn(() => {
      const oscillator = {
        type: '',
        frequency: { value: 0 },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => ({
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(),
    })),
    close: jest.fn(),
  };
  const AudioContextMock = jest.fn(() => ctx);
  Object.defineProperty(window, 'AudioContext', {
    writable: true,
    configurable: true,
    value: AudioContextMock,
  });
  return { AudioContextMock, oscillators };
}

describe('notification sounds', () => {
  const originalAudioContext = window.AudioContext;

  afterEach(() => {
    Object.defineProperty(window, 'AudioContext', {
      writable: true,
      configurable: true,
      value: originalAudioContext,
    });
  });

  it('plays nothing when sound is turned off', () => {
    const { AudioContextMock } = installFakeAudioContext();
    useDocStore.setState({ soundEnabled: false });

    playTaskFinishedSound();
    playNeedsInputSound();

    expect(AudioContextMock).not.toHaveBeenCalled();
  });

  it('plays a chime when sound is turned on', () => {
    const { AudioContextMock, oscillators } = installFakeAudioContext();
    useDocStore.setState({ soundEnabled: true });

    playTaskFinishedSound();

    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(oscillators.length).toBeGreaterThan(0);
    oscillators.forEach((oscillator) => {
      expect(oscillator.start).toHaveBeenCalled();
    });
  });

  it('uses different pitches for the finished chime than the needs-input chime', () => {
    useDocStore.setState({ soundEnabled: true });

    const finished = installFakeAudioContext();
    playTaskFinishedSound();
    const finishedFrequencies = finished.oscillators.map(
      (o) => o.frequency.value,
    );

    const needsInput = installFakeAudioContext();
    playNeedsInputSound();
    const needsInputFrequencies = needsInput.oscillators.map(
      (o) => o.frequency.value,
    );

    expect(finishedFrequencies).not.toEqual(needsInputFrequencies);
  });

  it('never throws when AudioContext is unavailable', () => {
    Object.defineProperty(window, 'AudioContext', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    useDocStore.setState({ soundEnabled: true });

    expect(() => playTaskFinishedSound()).not.toThrow();
    expect(() => playNeedsInputSound()).not.toThrow();
  });
});
