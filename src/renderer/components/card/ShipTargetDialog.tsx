import type { ShipChooserPlan } from '@shared/worktree';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ChoicePlan = Exclude<
  ShipChooserPlan,
  { kind: 'direct' } | { kind: 'blocked' }
>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: ChoicePlan | null;
  onSelect: (branch: string) => void;
}

function descriptionFor(plan: ChoicePlan | null): string {
  if (!plan) return '';
  if (plan.kind === 'choose') {
    return `This card started from ${plan.recorded}, but the primary checkout is now on ${plan.current}. Choose where to merge it.`;
  }
  if (plan.kind === 'recorded-missing') {
    return `The original branch no longer exists. You can merge into the current branch, ${plan.current}.`;
  }
  return `The primary checkout is detached. You can merge into the original branch, ${plan.recorded}.`;
}

function branchesFor(plan: ChoicePlan | null): string[] {
  if (!plan) return [];
  if (plan.kind === 'choose') return [plan.recorded, plan.current];
  if (plan.kind === 'recorded-missing') return [plan.current];
  return [plan.recorded];
}

export function ShipTargetDialog({
  open,
  onOpenChange,
  plan,
  onSelect,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge into which branch?</DialogTitle>
          <DialogDescription className="wrap-break-word">
            {descriptionFor(plan)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-2">
          {branchesFor(plan).map((branch) => (
            <Button
              key={branch}
              className="h-auto min-w-0 justify-start whitespace-normal break-all py-2 text-left"
              onClick={() => onSelect(branch)}
            >
              Ship into {branch}
            </Button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
