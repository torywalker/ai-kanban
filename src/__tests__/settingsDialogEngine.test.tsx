import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

describe('SettingsDialog session engine', () => {
  beforeEach(() => {
    installElectronMock();
    window.electron.platform = 'darwin';
    useDocStore.setState({ sessionEngine: 'sdk', claudeCliPath: null });
  });

  it('persists Terminal as the global session engine', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    const terminal = screen.getByRole('button', {
      name: 'Terminal (Claude CLI)',
    });
    fireEvent.click(terminal);

    expect(terminal).toHaveAttribute('aria-pressed', 'true');
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      sessionEngine: 'terminal',
    });
  });

  it('saves the Claude CLI path on blur and clears it to null', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    const path = screen.getByRole('textbox', { name: 'Claude CLI path' });
    fireEvent.change(path, { target: { value: '/opt/claude' } });
    fireEvent.blur(path);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      claudeCliPath: '/opt/claude',
    });

    fireEvent.change(path, { target: { value: '' } });
    fireEvent.blur(path);
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      claudeCliPath: null,
    });
  });

  it('disables Terminal on Windows', () => {
    window.electron.platform = 'win32';
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    expect(
      screen.getByRole('button', { name: 'Terminal (Claude CLI)' }),
    ).toBeDisabled();
    expect(
      screen.getByText("Terminal sessions aren't available on Windows yet."),
    ).toBeInTheDocument();
  });
});
