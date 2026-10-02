import { useShellState } from '../store';

interface PrQuickOpenProps {
  buttonClass: string;
}

// P5: shown when any of the token user's sessions (from the last API poll)
// have open pull requests. Clicking opens a native Menu.popup in main grouped
// by session; each item switches to its session and opens the PR in the pane.
export function PrQuickOpen({ buttonClass }: PrQuickOpenProps) {
  const state = useShellState();
  const count = state?.notifications.openPrCount ?? 0;
  return (
    <>
      {count > 0 && (
        <button
          id="prQuickOpen"
          type="button"
          aria-label={`Open pull requests (${count})`}
          title={`Open pull requests (${count})`}
          className={`${buttonClass} relative text-sm`}
          onClick={() => window.devinworkspaces.openPrMenu()}
        >
          PR
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#54749c] text-[10px] leading-4">
            {count}
          </span>
        </button>
      )}
    </>
  );
}
