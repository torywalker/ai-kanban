/* eslint-disable import/prefer-default-export, no-use-before-define */

/** Jest stand-in for `@xterm/addon-search`. Tests read `SearchAddon.instances`. */
export class SearchAddon {
  static instances: SearchAddon[] = [];

  findNext = jest.fn(() => true);

  findPrevious = jest.fn(() => true);

  clearDecorations = jest.fn();

  constructor() {
    SearchAddon.instances.push(this);
  }
}
