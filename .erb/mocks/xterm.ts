/* eslint-disable import/prefer-default-export, no-use-before-define */

export interface MockTerminalOptions {
  fontSize?: number;
  fontFamily?: string;
  theme?: { background?: string; foreground?: string; cursor?: string };
}

/** Jest stand-in for `@xterm/xterm`. Tests read `Terminal.instances`. */
export class Terminal {
  static instances: Terminal[] = [];

  cols = 80;

  rows = 24;

  options: MockTerminalOptions;

  open = jest.fn();

  write = jest.fn();

  reset = jest.fn();

  loadAddon = jest.fn();

  dispose = jest.fn();

  focus = jest.fn();

  /** The handler TerminalPanel registers; tests call it directly. */
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

  attachCustomKeyEventHandler = jest.fn(
    (handler: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = handler;
    },
  );

  onData = jest.fn((handler: (data: string) => void) => ({
    dispose: jest.fn(),
    listener: handler,
  }));

  constructor(options?: MockTerminalOptions) {
    this.options = options ?? {};
    Terminal.instances.push(this);
  }
}
