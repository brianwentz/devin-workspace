import { useEffect, useRef, useState } from 'react';
import type { Rect } from '../../core/layout';
import type { ShellState } from '../../shared/ipc';
import { TerminalView } from '../local/TerminalView';

type TerminalEntry = ShellState['terminals'][number];

interface TerminalDockProps {
  // null/absent when the dock is hidden — the dock stays mounted so ptys and
  // scrollback survive toggles and surface switches.
  rect: Rect | null;
  terminals: TerminalEntry[];
  activeTerminalId: string | null;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function TerminalDock({ rect, terminals, activeTerminalId }: TerminalDockProps) {
  // Devin-kind ptys belong to LocalPanel's Terminal tab — the dock only hosts
  // user shell terminals.
  const shells = terminals.filter((entry) => entry.kind === 'shell');
  const activeId = shells.some((entry) => entry.id === activeTerminalId)
    ? activeTerminalId
    : (shells.at(-1)?.id ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cwdOptions, setCwdOptions] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const openShell = (cwd: string | undefined) => {
    setMenuOpen(false);
    void window.devinworkspaces
      .terminalOpen(cwd === undefined ? { kind: 'shell' } : { kind: 'shell', cwd })
      .then((result) => {
        if (result.ok) window.devinworkspaces.terminalActivate(result.id);
      });
  };

  return (
    <section
      id="terminalDock"
      aria-label="Terminal dock"
      className="shell-chrome absolute flex flex-col bg-[#0d141d] border-t border-[#39475a]"
      style={{
        left: rect?.x ?? 0,
        top: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        display: rect ? 'flex' : 'none',
      }}
    >
      <div
        id="terminalDockTabs"
        role="tablist"
        aria-label="Terminals"
        className="flex items-stretch h-[30px] flex-none bg-[#101722] border-b border-[#39475a] overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {shells.map((entry) => (
          <div
            key={entry.id}
            role="tab"
            aria-selected={entry.id === activeId}
            aria-label={entry.title}
            title={entry.cwd}
            className={`tab terminal-tab${entry.id === activeId ? ' active' : ''}`}
            data-terminal-tab={entry.id}
            onClick={() => window.devinworkspaces.terminalActivate(entry.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                window.devinworkspaces.terminalClose(entry.id);
              }
            }}
          >
            <span className="tabTitle">
              {entry.title}
              {entry.exitCode !== null ? ` exited (code ${entry.exitCode})` : ''}
            </span>
            <button
              type="button"
              className="closeMark"
              aria-label={`Close ${entry.title}`}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                window.devinworkspaces.terminalClose(entry.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="relative flex items-stretch" ref={menuRef}>
          <button
            id="terminalNew"
            type="button"
            aria-label="New terminal"
            aria-expanded={menuOpen}
            className="px-2.5 text-[#aeb9c8] hover:text-white self-stretch"
            onClick={() => {
                const next = !menuOpen;
                setMenuOpen(next);
                if (next) {
                  void window.devinworkspaces.terminalCwdOptions().then(setCwdOptions);
                }
              }}
          >
            +
          </button>
          {menuOpen && (
            <div
              id="terminalNewMenu"
              className="absolute top-[30px] left-0 z-10 min-w-56 max-w-md rounded-md border border-[#39475a] bg-[#1a2330] py-1 shadow-lg"
            >
              {cwdOptions.map((cwd) => (
                <button
                  key={cwd}
                  type="button"
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-[#e8edf5] hover:bg-[#2a394d]"
                  title={cwd}
                  onClick={() => openShell(cwd)}
                >
                  {baseName(cwd)}
                  <span className="ml-2 text-[#7f8ca0]">{cwd}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {shells.map((entry) => (
          <div
            key={entry.id}
            className="absolute inset-0 flex flex-col"
            style={{ display: entry.id === activeId ? 'flex' : 'none' }}
          >
            <TerminalView id={entry.id} />
            {entry.exitCode !== null && (
              <div className="absolute right-3 top-1.5 text-[11px] text-[#e0a03c]">
                exited (code {entry.exitCode})
              </div>
            )}
          </div>
        ))}
        {shells.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-[#7d8a99]">
            No terminals — press + to open a shell.
          </div>
        )}
      </div>
    </section>
  );
}
