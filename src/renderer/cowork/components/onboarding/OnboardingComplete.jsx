import Ico from '../Icons';
import { Button } from '../ui';

// The reward state — shown once every step is done, until the user
// dismisses the checklist for good.
export default function OnboardingComplete({ onDismiss }) {
  return (
    <div className="flex flex-col items-center text-center gap-[14px] pt-[10px] px-1 pb-[2px]">
      <span className="w-[56px] h-[56px] rounded-full grid place-items-center bg-accent-bg text-accent">
        {Ico.taskCheck(30)}
      </span>
      <div className="text-md font-[650] text-strong">
        You&rsquo;ve got the basics!
      </div>
      <Button block onClick={onDismiss}>Close</Button>
    </div>
  );
}
