import { RAIL_WIDTH, TITLE_BAR_HEIGHT } from '../../core/layout';
import type { Surface } from '../../shared/ipc';
import { PrQuickOpen } from './PrQuickOpen';

interface RailProps {
  surface: Surface;
  paneOpen: boolean;
  paneCollapsed: boolean;
  credentialMatch: { origin: string; username: string } | null;
  terminalOpen: boolean;
  terminalAllSurfaces: boolean;
}

const buttonClass =
  'w-10 h-10 text-xl rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] aria-pressed:bg-[#31455f] aria-pressed:border-[#54749c]';

export function Rail({
  surface,
  paneOpen,
  paneCollapsed,
  credentialMatch,
  terminalOpen,
  terminalAllSurfaces,
}: RailProps) {
  const terminalOffSurface = surface !== 'cloud' && !terminalAllSurfaces;
  return (
    <aside
      id="rail"
      className="shell-chrome absolute top-0 bottom-0 left-0 flex flex-col items-center gap-2.5 bg-[#101722]"
      style={{ width: RAIL_WIDTH, paddingTop: TITLE_BAR_HEIGHT + 8 }}
    >
      <button
        id="cloudButton"
        type="button"
        aria-label="Cloud"
        aria-pressed={surface === 'cloud'}
        title="Cloud"
        className={buttonClass}
        onClick={() => window.devinworkspaces.setSurface('cloud')}
      >
        ☁
      </button>
      <button
        id="localButton"
        type="button"
        aria-label="Local"
        aria-pressed={surface === 'local'}
        title="Local"
        className={buttonClass}
        onClick={() => window.devinworkspaces.setSurface('local')}
      >
        ⌘
      </button>
      <button
        id="settingsButton"
        type="button"
        aria-label="Settings"
        aria-pressed={surface === 'settings'}
        title="Settings"
        className={buttonClass}
        onClick={() => window.devinworkspaces.setSurface('settings')}
      >
        ⚙
      </button>
      {credentialMatch && (
        <button
          id="credentialsButton"
          type="button"
          aria-label="Fill credentials"
          title={`Fill saved credentials for ${credentialMatch.origin}`}
          className={buttonClass}
          onClick={() => window.devinworkspaces.openCredentialsMenu()}
        >
          🔑
        </button>
      )}
      <PrQuickOpen buttonClass={buttonClass} />
      <span className="flex-1" />
      <button
        id="terminalToggle"
        type="button"
        aria-label="Toggle terminal"
        aria-pressed={terminalOpen}
        title={
          terminalOffSurface
            ? 'Terminal dock shows on Cloud — enable for all surfaces in Settings'
            : 'Toggle terminal (Ctrl+`)'
        }
        className={`${buttonClass} text-sm${terminalOffSurface ? ' opacity-50' : ''}`}
        onClick={() => window.devinworkspaces.terminalToggle()}
      >
        &gt;_
      </button>
      <button
        id="paneToggle"
        type="button"
        aria-label="Toggle GitHub pane"
        aria-pressed={paneOpen}
        title={paneCollapsed ? 'GitHub pane hidden — widen window' : 'Toggle GitHub pane'}
        className={`${buttonClass} relative mb-3 text-sm`}
        onClick={() => window.devinworkspaces.togglePane()}
      >
        GH
        {paneCollapsed && paneOpen && (
          <span
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#e0a03c]"
            title="pane hidden — widen window"
          />
        )}
      </button>
    </aside>
  );
}
