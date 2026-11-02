/* eslint-disable import/prefer-default-export, no-use-before-define */

/** Jest stand-in for `@xterm/addon-fit`. Tests read `FitAddon.instances`. */
export class FitAddon {
  static instances: FitAddon[] = [];

  fit = jest.fn();

  constructor() {
    FitAddon.instances.push(this);
  }
}
