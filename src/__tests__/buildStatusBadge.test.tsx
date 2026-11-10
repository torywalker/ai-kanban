import { act, render, screen } from '@testing-library/react';
import { BuildStatusBadge } from '../renderer/components/card/BuildStatusBadge';
import { useBuildStatusStore } from '../renderer/store/buildStatusStore';
import type { BuildCheck, BuildStatus } from '../shared/buildStatus';

const check = (name: string, state: BuildCheck['state']): BuildCheck => ({
  name,
  state,
  url: null,
});

function show(checks: BuildCheck[], kind: BuildStatus['kind'] = 'pr') {
  act(() => {
    useBuildStatusStore.getState().apply({
      paused: null,
      statuses: [{ cardId: 'c1', kind, url: null, checks, stale: false }],
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
});
