import {
  destinationsForShipPlan,
  planShipChooser,
} from '../shared/worktree';

describe('planShipChooser', () => {
  it('ships directly when current branch equals recorded target', () => {
    expect(
      planShipChooser({
        recorded: 'main',
        current: { kind: 'branch', name: 'main' },
        recordedExists: true,
      }),
    ).toEqual({ kind: 'direct', destination: 'main' });
  });

  it('ships directly when names match even if recorded ref no longer exists', () => {
    // Same branch name after history moved — still direct per spec §7.
    expect(
      planShipChooser({
        recorded: 'main',
        current: { kind: 'branch', name: 'main' },
        recordedExists: false,
      }),
    ).toEqual({ kind: 'direct', destination: 'main' });
  });

  it('offers a choice when current differs and recorded still exists', () => {
    expect(
      planShipChooser({
        recorded: 'main',
        current: { kind: 'branch', name: 'develop' },
        recordedExists: true,
      }),
    ).toEqual({ kind: 'choose', recorded: 'main', current: 'develop' });
  });

  it('offers only current when recorded branch is gone', () => {
    expect(
      planShipChooser({
        recorded: 'old-feature',
        current: { kind: 'branch', name: 'develop' },
        recordedExists: false,
      }),
    ).toEqual({ kind: 'recorded-missing', current: 'develop' });
  });

  it('offers only recorded when HEAD is detached', () => {
    expect(
      planShipChooser({
        recorded: 'main',
        current: { kind: 'detached' },
        recordedExists: true,
      }),
    ).toEqual({ kind: 'detached-with-recorded', recorded: 'main' });
  });

  it('blocks when detached and recorded branch is gone', () => {
    expect(
      planShipChooser({
        recorded: 'main',
        current: { kind: 'detached' },
        recordedExists: false,
      }),
    ).toEqual({
      kind: 'blocked',
      message:
        'Cannot ship: the original branch is gone and HEAD is detached.',
    });
  });
});

describe('destinationsForShipPlan', () => {
  it('returns only destinations presented by the current chooser plan', () => {
    expect(
      destinationsForShipPlan({
        kind: 'choose',
        recorded: 'main',
        current: 'develop',
      }),
    ).toEqual(['main', 'develop']);
    expect(
      destinationsForShipPlan({
        kind: 'recorded-missing',
        current: 'develop',
      }),
    ).toEqual(['develop']);
    expect(
      destinationsForShipPlan({
        kind: 'blocked',
        message: 'Cannot ship.',
      }),
    ).toEqual([]);
  });
});
