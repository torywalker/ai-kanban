/**
 * Settings used to be one long stacked column, so on a short window the
 * bottom of the dialog (tags, recent files) ran off the screen with no way
 * to reach it. Two things keep that from coming back: the settings are
 * grouped into tabs so only one group is on screen at a time, and the dialog
 * is capped at 85vh with the active panel as the scroll region — the same
 * shape the card dialogs already use.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

function dialogContent(): HTMLElement {
  return document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
}

function activePanel(): HTMLElement {
  return document.querySelector('[data-slot="tabs-content"]') as HTMLElement;
}

describe('SettingsDialog stays inside the window', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({
      filePath: '/Users/me/kanban.json',
      useWorktrees: false,
      defaultModel: null,
    });
  });

  it('never claims more height than the window, and scrolls the panel instead', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);

    expect(dialogContent().className).toContain('max-h-[85vh]');

    const { className } = activePanel();
    expect(className).toContain('overflow-y-auto');
    // Without `min-h-0` a flex child refuses to shrink below its content,
    // which is exactly how the dialog outgrew the window before.
    expect(className).toContain('min-h-0');
  });

  it('opens on the data file group and leaves the other groups off screen', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByRole('button', { name: 'Create Backup' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Run cards in git worktrees' }),
    ).not.toBeInTheDocument();
  });

  it('swaps in one group at a time as tabs are selected', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);

    selectTab('Agent sessions');
    expect(
      screen.getByRole('checkbox', { name: 'Run cards in git worktrees' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create Backup' }),
    ).not.toBeInTheDocument();

    selectTab('Tags');
    expect(screen.getByText(/No tags yet/)).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Run cards in git worktrees' }),
    ).not.toBeInTheDocument();
  });
});
