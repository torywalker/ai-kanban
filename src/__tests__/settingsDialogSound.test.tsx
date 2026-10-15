import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

describe('SettingsDialog notification sounds', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ soundEnabled: true });
  });

  it('defaults to on', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    expect(
      screen.getByRole('checkbox', { name: 'Play notification sounds' }),
    ).toBeChecked();
  });

  it('can be turned off and persists the change', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Play notification sounds' }),
    );

    expect(useDocStore.getState().soundEnabled).toBe(false);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      soundEnabled: false,
    });
  });
});
