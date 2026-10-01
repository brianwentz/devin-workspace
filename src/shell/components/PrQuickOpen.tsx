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
  const waiting = state?.notifications.waitingCount ?? 0;
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
      {waiting > 0 && (
        <span
          id="waitingBadge"
          title={`${waiting} session${waiting === 1 ? '' : 's'} waiting for you`}
          className="min-w-5 h-5 px-1 rounded-full bg-[#d93a2f] text-[11px] leading-5 text-center"
        >
          {waiting > 9 ? '9+' : waiting}
        </span>
      )}
    </>
  );
}
