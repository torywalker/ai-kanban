import { act, fireEvent, render, screen } from '@testing-library/react';
import { BuildStatusBadge } from '../renderer/components/card/BuildStatusBadge';
import { useBuildStatusStore } from '../renderer/store/buildStatusStore';
import type { BuildCheck, BuildStatus } from '../shared/buildStatus';

const check = (name: string, state: BuildCheck['state']): BuildCheck => ({
  name,
  state,
  url: null,
});

function show(
  checks: BuildCheck[],
  kind: BuildStatus['kind'] = 'pr',
  url: string | null = null,
) {
  act(() => {
    useBuildStatusStore.getState().apply({
      paused: null,
      statuses: [{ cardId: 'c1', kind, url, checks, stale: false }],
    });
  });
  render(<BuildStatusBadge cardId="c1" />);
}

describe('BuildStatusBadge', () => {
  it('shows a ring (not a spinner) and names the steps still running', () => {
    show([
      check('lint', 'pass'),
      check('build', 'pending'),
      check('deploy', 'pending'),
    ]);
    expect(
      screen.getByRole('button', { name: 'Running 1/3: build, deploy' }),
    ).toBeTruthy();
  });

  it('does not claim 0/0 when no checks have been reported yet', () => {
    show([]);
    expect(
      screen.getByRole('button', { name: 'Waiting for checks to start' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /0\/0/ })).toBeNull();
  });

  it('names the failing step on failure', () => {
    show([check('lint', 'fail'), check('build', 'pending')]);
    expect(
      screen.getByRole('button', { name: 'Build failed: lint' }),
    ).toBeTruthy();
  });

  it('opens a tooltip with the headline, failing steps and a click hint', () => {
    show(
      [check('lint', 'fail'), check('build', 'pending'), check('test', 'pass')],
      'pr',
      'https://github.com/o/r/pull/1',
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getAllByText('Build failed').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('1 failed · 1 running · 1 passed').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('lint').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Click to open on GitHub').length,
    ).toBeGreaterThan(0);
  });

  it('explains states that have no link, since they are not disabled', () => {
    show([], 'unpushed');
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getAllByText('Not pushed yet').length).toBeGreaterThan(0);
    expect(screen.queryByText('Click to open on GitHub')).toBeNull();
  });
});
