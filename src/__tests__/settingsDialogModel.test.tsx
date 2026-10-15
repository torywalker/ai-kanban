/**
 * Settings' "Default model" was a free-text field — the same class of UI
 * this app moved away from for the per-card override (see
 * modelPickerOverrides.test.tsx). It now shares the same `ModelPicker`
 * dropdown, so there is exactly one way to pick a model anywhere in the app,
 * not two that could drift apart.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

describe('SettingsDialog default model', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ defaultModel: null });
  });

  it('renders a dropdown button, not a free-text field, when nothing is set', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    expect(
      screen.getByRole('button', { name: /Uses your Claude Code CLI default/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /default model/i })).not.toBeInTheDocument();
  });

  it('shows a pinned custom model id as the current selection, same as the card override picker', () => {
    useDocStore.setState({ defaultModel: 'claude-opus-4-8' });
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Agent sessions');

    expect(
      screen.getByRole('button', { name: /claude-opus-4-8/ }),
    ).toBeInTheDocument();
  });

  // Opening the dropdown and picking an alias is exercised for this exact
  // component in modelPickerOverrides.test.tsx (same `ModelPicker`, same
  // `onChange` contract) — not repeated here to avoid a second copy of the
  // pre-existing jsdom/Radix pointer-event gap documented there.
});
