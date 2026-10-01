import type { CSSProperties } from 'react';
import type { ShellState } from '../../shared/ipc';

type Tab = ShellState['tabs']['tabs'][number];

interface NavBarProps {
  active: Tab | null;
  style: CSSProperties;
}

const navButton =
  'min-w-[29px] min-h-[26px] rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] leading-none disabled:hover:bg-[#1a2330]';

export function NavBar({ active, style }: NavBarProps) {
  return (
    <nav id="navBar" aria-label="GitHub navigation" className="shell-chrome bg-[#151e2a]" style={style}>
      <div className="navControls h-8 flex items-center gap-1.5 px-1.5 py-0.5">
        <button
          id="backButton"
          type="button"
          aria-label="Back"
          className={navButton}
          disabled={!active?.canGoBack}
          onClick={() => window.devinworkspaces.navigate('back')}
        >
          ←
        </button>
        <button
          id="forwardButton"
          type="button"
          aria-label="Forward"
          className={navButton}
          disabled={!active?.canGoForward}
          onClick={() => window.devinworkspaces.navigate('forward')}
        >
          →
        </button>
        <button
          id="reloadButton"
          type="button"
          aria-label="Reload"
          className={navButton}
          disabled={!active}
          onClick={() => window.devinworkspaces.navigate('reload')}
        >
          ↻
        </button>
        <span className="navSpacer flex-1" />
        {[420, 560, 760].map((width, i) => (
          <button
            key={width}
            className={`${navButton} preset min-w-[25px] text-[11px]`}
            data-width={width}
            type="button"
            onClick={() => window.devinworkspaces.setPaneWidth(width)}
          >
            {'SML'[i]}
          </button>
        ))}
      </div>
    </nav>
  );
}
