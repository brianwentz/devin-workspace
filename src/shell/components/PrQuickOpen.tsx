import { useShellState } from '../store';

interface PrQuickOpenProps {
  buttonClass: string;
}

// P5: shown only when the current Devin session (from the last API poll) has
// pull requests. Clicking opens a native Menu.popup in main; each item routes
// through handleLink so GitHub URLs land in the pane.
export function PrQuickOpen({ buttonClass }: PrQuickOpenProps) {
  const state = useShellState();
  const count = state?.notifications.currentSessionPrCount ?? 0;
  return (
    <>
      {count > 0 && (
        <button
          id="prQuickOpen"
          type="button"
          aria-label={`Open session pull requests (${count})`}
          title={`Session pull requests (${count})`}
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
