import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

describe('SettingsDialog worktree default', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ useWorktrees: false });
  });

  it('persists the global worktree setting', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Run cards in git worktrees',
      }),
    );

    expect(useDocStore.getState().useWorktrees).toBe(true);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      useWorktrees: true,
    });
    expect(
      screen.getByText(
        'Each Run gets its own git worktree. Ship merges it back.',
      ),
    ).toBeInTheDocument();
  });
});
